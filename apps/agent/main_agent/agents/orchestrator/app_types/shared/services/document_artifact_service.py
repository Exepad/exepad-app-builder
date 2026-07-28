"""
Document Artifact Service for content-aware app generation.

This module provides utilities for:
- Fetching small documents from content_url and saving as artifacts
- Checking artifact deduplication via list_artifact_keys
- Categorizing documents into small (artifacts) vs large (Vertex AI Search)
- Generating image_catalog_summary from image catalog
- Extracting and resolving @filename references from user prompts

Used by workflows to prepare content context for planner agents.
"""

import re
import asyncio
import structlog
import aiohttp
from dataclasses import dataclass, field
from typing import Optional
from google.adk.agents.invocation_context import InvocationContext
from google import genai
from ...base.base_service import BaseService
from main_agent.net.url_guard import assert_safe_url, UnsafeUrlError

from config import (
    DOCUMENT_MAX_SIZE_CHARS,
    IMAGE_CATALOG_SUMMARY_LIMIT,
    IMAGE_DESCRIPTION_MAX_LENGTH,
    DOCUMENT_FETCH_MAX_RETRIES,
    DOCUMENT_FETCH_INITIAL_DELAY,
    DOCUMENT_FETCH_BACKOFF_MULTIPLIER,
    DOCUMENT_FETCH_TIMEOUT,
    SKIP_DOCUMENT_FETCH,
)

logger = structlog.get_logger(__name__)

# Hard cap on per-document summary size in prompt payloads. Summaries are a
# hint for agents deciding whether to fetch the full document via Vertex AI
# Search; the full text is never inlined here. Caps avoid paying thousands of
# tokens per turn for an unbounded summary field from upstream metadata.
DOCUMENT_SUMMARY_MAX_CHARS = 500


def _truncate_summary(summary: str) -> str:
    if not summary or len(summary) <= DOCUMENT_SUMMARY_MAX_CHARS:
        return summary
    return summary[: DOCUMENT_SUMMARY_MAX_CHARS - 1] + "…"


@dataclass
class ContentContext:
    """Content context prepared for planner agents."""

    document_artifact_list: list[str] = field(default_factory=list)
    """List of artifact filenames for small documents (e.g., ['doc:product-spec.md', ...])"""

    large_document_list: list[dict] = field(default_factory=list)
    """List of large document summaries for Vertex AI Search (e.g., [{'source_name': '...', 'summary': '...'}])"""

    image_catalog_summary: str = "No images available."
    """Human-readable summary of available images"""

    # User-referenced files (explicit @filename mentions in user prompt)
    user_referenced_images: list[str] = field(default_factory=list)
    """Image UUIDs explicitly referenced by user with @filename syntax (HIGH PRIORITY)"""

    user_referenced_documents: list[str] = field(default_factory=list)
    """Document artifact names explicitly referenced by user with @filename syntax (HIGH PRIORITY)"""

    user_referenced_large_documents: list[dict] = field(default_factory=list)
    """Large documents explicitly referenced by user with @filename syntax (HIGH PRIORITY).
    Each entry has 'uuid', 'source_name', 'summary'."""

    # Error tracking
    unresolved_references: list[str] = field(default_factory=list)
    """Filenames from @filename syntax that couldn't be matched to any catalog entry"""

    # Structured-data routing for DataIngester pre-pass
    structured_documents: dict[str, dict] = field(default_factory=dict)
    """Map of `doc:{name}.md` artifact name → structured-data metadata for the
    DataIngester pre-pass. Populated whenever a `document_catalog` entry has
    `has_structured_data: true`. Each value carries:

    - `has_structured_data: bool`
    - `structured_data_sample: dict | None` — backend's 10-row schema preview
    - `structured_data_url: str | None` — signed URL to JSONL (BE-2)
    - `original_mime_type: str | None` — backend-emitted mime type (BE-2)
    - `original_filename: str` — original `source_name`
    - `original_format: str` — extension-inferred fallback when mime type missing
      (one of `xlsx`/`xls`/`csv`/`tsv`/`docx`/`pptx`/`pdf`/`md`/`txt`/`unknown`)
    """


class DocumentArtifactService(BaseService):
    """
    Prepares document and image content context for planner agents.

    This service:
    1. Fetches small documents from content_url and saves as artifacts
    2. Identifies large documents that should use Vertex AI Search
    3. Generates image catalog summary for content-aware generation

    Used by CreationWorkflow and EditingWorkflow.
    """

    # Use configurable max document size from config
    MAX_DOCUMENT_SIZE = DOCUMENT_MAX_SIZE_CHARS

    @staticmethod
    async def prepare_content_context(
        ctx: InvocationContext,
        user_prompt: str = "",
    ) -> ContentContext:
        """
        Prepare all content context for planner.

        This method:
        1. Extracts @filename references from user prompt (HIGH PRIORITY)
        2. Fetches small documents from content_url and saves as artifacts
        3. Identifies large documents for Vertex AI Search
        4. Generates image catalog summary

        Args:
            ctx: Invocation context with session state containing catalogs
            user_prompt: User's prompt text (for extracting @filename references)

        Returns:
            ContentContext with:
            - document_artifact_list: ["doc:product-spec.md", ...]
            - large_document_list: [{"source_name": "...", "summary": "..."}]
            - image_catalog_summary: "3 images available..."
            - user_referenced_images: ["uuid1", ...] (explicitly requested by user)
            - user_referenced_documents: ["doc:file.md", ...] (explicitly requested by user)
        """
        content_context = ContentContext()

        # Get catalogs from session state
        document_catalog = ctx.session.state.get("document_catalog", [])
        image_catalog = ctx.session.state.get("image_catalog", [])

        # Extract and resolve @filename references from user prompt
        if user_prompt:
            DocumentArtifactService._resolve_file_references(
                user_prompt, image_catalog, document_catalog, content_context
            )

        # Prepare document artifacts
        if document_catalog:
            await DocumentArtifactService._prepare_document_artifacts(
                ctx, document_catalog, content_context
            )

        # Generate image catalog summary (prioritizing user-referenced images)
        if image_catalog:
            content_context.image_catalog_summary = (
                DocumentArtifactService._generate_image_catalog_summary(
                    image_catalog,
                    user_referenced_images=content_context.user_referenced_images,
                )
            )

        logger.info(
            f"[DocumentArtifactService] Prepared content context: "
            f"{len(content_context.document_artifact_list)} document artifacts, "
            f"{len(content_context.large_document_list)} large documents, "
            f"image summary: {len(content_context.image_catalog_summary)} chars, "
            f"user-referenced images: {len(content_context.user_referenced_images)}, "
            f"user-referenced docs: {len(content_context.user_referenced_documents)}, "
            f"user-referenced large docs: {len(content_context.user_referenced_large_documents)}, "
            f"structured documents: {len(content_context.structured_documents)}"
        )

        return content_context

    @staticmethod
    async def _prepare_document_artifacts(
        ctx: InvocationContext,
        document_catalog: list[dict],
        content_context: ContentContext,
    ) -> None:
        """
        Prepare document artifacts from the document catalog.

        Small documents are fetched and saved as artifacts.
        Large documents are added to the large_document_list for Vertex AI Search.

        Args:
            ctx: Invocation context
            document_catalog: List of document entries from catalog
            content_context: ContentContext to populate
        """
        # Get existing artifact keys to check for deduplication
        try:
            existing_artifacts = await ctx.artifact_service.list_artifact_keys(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
            )
            existing_artifact_set = set(existing_artifacts)
        except Exception as e:
            logger.warning(f"[DocumentArtifactService] Could not list existing artifacts: {e}")
            existing_artifact_set = set()

        for doc_entry in document_catalog:
            source_name = doc_entry.get("source_name", "unknown")
            characters_count = doc_entry.get("characters_count", 0)
            content_url = doc_entry.get("content_url")
            summary = _truncate_summary(doc_entry.get("summary", ""))
            doc_uuid = doc_entry.get("uuid", "")
            content_hash = doc_entry.get("content_hash", "")

            # Generate artifact filename with content hash for freshness detection
            # Format: doc:{safe_name}_{hash[:8]}.md (e.g., doc:product-spec_a1b2c3d4.md)
            artifact_filename = DocumentArtifactService._compute_doc_artifact_name(
                source_name, content_hash
            )

            # Record structured-data metadata (DataIngester pre-pass routing).
            # Done before MD fetch decisions so the DataIngester can still
            # operate on large docs whose MD wouldn't be inlined as artifact.
            DocumentArtifactService._record_structured_document(
                content_context, doc_entry, artifact_filename
            )

            # Check if document is small enough to load as artifact
            if characters_count <= DocumentArtifactService.MAX_DOCUMENT_SIZE:
                # Check if artifact already exists (deduplication by hash)
                if artifact_filename in existing_artifact_set:
                    logger.debug(
                        f"[DocumentArtifactService] Artifact already exists (fresh): {artifact_filename}"
                    )
                    content_context.document_artifact_list.append(artifact_filename)
                    continue

                # Check for stale artifacts with same name but different hash
                # This handles document updates - old artifact won't match new hash
                stale_safe_name = DocumentArtifactService._sanitize_filename(source_name)
                stale_artifact = next(
                    (
                        a
                        for a in existing_artifact_set
                        if a.startswith(f"doc:{stale_safe_name}_") and a != artifact_filename
                    ),
                    None,
                )
                if stale_artifact:
                    logger.info(
                        f"[DocumentArtifactService] Found stale artifact {stale_artifact}, "
                        f"will fetch fresh version: {artifact_filename}"
                    )

                # Fetch and save the document
                if content_url:
                    success = await DocumentArtifactService._fetch_and_save_document(
                        ctx, content_url, artifact_filename
                    )
                    if success:
                        content_context.document_artifact_list.append(artifact_filename)
                    else:
                        # Fallback: add to large docs list if fetch fails
                        content_context.large_document_list.append(
                            {
                                "uuid": doc_uuid,
                                "source_name": source_name,
                                "summary": summary,
                            }
                        )
                else:
                    logger.warning(
                        f"[DocumentArtifactService] No content_url for document: {source_name}"
                    )
            else:
                # Large document - use Vertex AI Search
                content_context.large_document_list.append(
                    {
                        "uuid": doc_uuid,
                        "source_name": source_name,
                        "summary": summary,
                        "characters_count": characters_count,
                    }
                )
                logger.info(
                    f"[DocumentArtifactService] Document '{source_name}' marked as large "
                    f"({characters_count} chars > {DocumentArtifactService.MAX_DOCUMENT_SIZE})"
                )

    @staticmethod
    async def _fetch_and_save_document(
        ctx: InvocationContext,
        content_url: str,
        artifact_filename: str,
    ) -> bool:
        """
        Fetch document content from URL and save as artifact.

        Implements exponential backoff retry for transient failures (5xx errors, timeouts).
        Validates content-type header before processing.

        Args:
            ctx: Invocation context
            content_url: URL to fetch document content from
            artifact_filename: Filename for the artifact

        Returns:
            True if successful, False otherwise

        Note:
            Set SKIP_DOCUMENT_FETCH=true environment variable to skip actual HTTP
            fetching (useful for E2E tests with mock document catalogs).
        """
        # Skip fetching in test mode - useful for E2E tests with mock catalogs
        if SKIP_DOCUMENT_FETCH:
            logger.info(
                f"[DocumentArtifactService] Skipping fetch for {artifact_filename} "
                f"(SKIP_DOCUMENT_FETCH=true)"
            )
            # Save a placeholder artifact with mock content
            mock_content = f"# {artifact_filename}\n\nMock content for testing."
            content_bytes = mock_content.encode("utf-8")
            artifact = genai.types.Part.from_bytes(data=content_bytes, mime_type="text/markdown")
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=artifact_filename,
                artifact=artifact,
            )
            return True

        # SSRF guard: content_url is copied verbatim from the /r request payload.
        # Reject internal/metadata targets before any request; a blocked URL is a
        # terminal failure (never retried).
        try:
            await assert_safe_url(content_url)
        except UnsafeUrlError as exc:
            logger.warning(
                "[DocumentArtifactService] Refusing to fetch unsafe URL",
                url=content_url,
                error=str(exc),
            )
            return False

        delay = DOCUMENT_FETCH_INITIAL_DELAY
        last_error: Optional[str] = None

        for attempt in range(DOCUMENT_FETCH_MAX_RETRIES + 1):
            try:
                async with aiohttp.ClientSession() as session:
                    # allow_redirects=False: a redirect can't bounce the request to
                    # an internal target; a 3xx falls through the status!=200 path.
                    async with session.get(
                        content_url,
                        timeout=aiohttp.ClientTimeout(total=DOCUMENT_FETCH_TIMEOUT),
                        allow_redirects=False,
                    ) as response:
                        if response.status == 200:
                            # Validate content type - accept text-based content
                            content_type = response.headers.get("Content-Type", "")
                            if not content_type.startswith(
                                ("text/", "application/json", "application/octet-stream")
                            ):
                                logger.warning(
                                    f"[DocumentArtifactService] Unexpected content type '{content_type}' "
                                    f"for {content_url}, attempting to read as text"
                                )

                            # Handle encoding gracefully
                            encoding = response.charset or "utf-8"
                            try:
                                content = await response.text(encoding=encoding)
                            except UnicodeDecodeError:
                                logger.warning(
                                    f"[DocumentArtifactService] Failed to decode content from "
                                    f"{content_url} with encoding {encoding}"
                                )
                                return False

                            # Save as artifact
                            content_bytes = content.encode("utf-8")
                            artifact = genai.types.Part.from_bytes(
                                data=content_bytes, mime_type="text/markdown"
                            )

                            await ctx.artifact_service.save_artifact(
                                session_id=ctx.session.id,
                                user_id=ctx.session.user_id,
                                app_name=ctx.session.app_name,
                                filename=artifact_filename,
                                artifact=artifact,
                            )

                            logger.debug(
                                f"[DocumentArtifactService] Saved document artifact: {artifact_filename} "
                                f"({len(content_bytes)} bytes)"
                            )
                            return True

                        elif response.status >= 500:
                            # Server error - retry
                            last_error = f"HTTP {response.status}"
                        else:
                            # Client error (4xx) - don't retry
                            logger.warning(
                                f"[DocumentArtifactService] Failed to fetch {content_url}: "
                                f"HTTP {response.status}"
                            )
                            return False

            except asyncio.TimeoutError:
                last_error = f"Timeout after {DOCUMENT_FETCH_TIMEOUT}s"
            except aiohttp.ClientError as e:
                last_error = str(e)
            except Exception as e:
                logger.error(
                    f"[DocumentArtifactService] Error saving artifact {artifact_filename}: {e}"
                )
                return False

            # Retry with exponential backoff (only for retryable errors)
            if attempt < DOCUMENT_FETCH_MAX_RETRIES:
                logger.info(
                    f"[DocumentArtifactService] Retry {attempt + 1}/{DOCUMENT_FETCH_MAX_RETRIES} "
                    f"for {content_url} after {delay:.1f}s (error: {last_error})"
                )
                await asyncio.sleep(delay)
                delay *= DOCUMENT_FETCH_BACKOFF_MULTIPLIER

        logger.warning(
            f"[DocumentArtifactService] Failed to fetch {content_url} after "
            f"{DOCUMENT_FETCH_MAX_RETRIES} retries: {last_error}"
        )
        return False

    @staticmethod
    def _generate_image_catalog_summary(
        image_catalog: list[dict],
        user_referenced_images: list[str] = None,
    ) -> str:
        """
        Generate a human-readable summary of the image catalog with UUIDs.

        User-referenced images (explicit @filename mentions) are prioritized and shown first.
        Uses configurable limits from config for summary size and description length.

        Args:
            image_catalog: List of image entries from catalog
            user_referenced_images: Optional list of UUIDs that user explicitly referenced

        Returns:
            Summary string with UUID, description, and metadata for each image
        """
        if not image_catalog:
            return "No images available."

        user_refs = set(user_referenced_images or [])
        total = len(image_catalog)

        # Sort: user-referenced images first, then logos, then by source_type
        def sort_key(img):
            img_uuid = img.get("uuid", "")
            is_user_ref = img_uuid not in user_refs  # False (0) for user-ref, True (1) for others
            is_logo = not img.get("is_logo", False)  # False (0) for logos, True (1) for non-logos
            source_type = img.get("source_type", "uploaded")
            return (is_user_ref, is_logo, source_type)

        sorted_catalog = sorted(image_catalog, key=sort_key)

        summaries = []
        limit = IMAGE_CATALOG_SUMMARY_LIMIT
        max_desc_len = IMAGE_DESCRIPTION_MAX_LENGTH

        for img in sorted_catalog[:limit]:
            img_uuid = img.get("uuid", "unknown")
            description = img.get("description", "No description")
            is_logo = img.get("is_logo", False)
            source_type = img.get("source_type", "uploaded")

            # Truncate description if too long (using configurable limit)
            if len(description) > max_desc_len:
                description = description[: max_desc_len - 3] + "..."

            # Build label with metadata
            label_parts = []
            if img_uuid in user_refs:
                label_parts.append("USER-REF")
            if is_logo:
                label_parts.append("LOGO")
            # Transparency surface (Layer 1/5). LLM uses these hints to
            # decide whether ``brightness-0 invert`` / blend-mode filters
            # are safe, and which image is usable on a dark container.
            has_transparent_bg = img.get("has_transparent_bg")
            has_baked_bg = img.get("has_baked_bg")
            if has_transparent_bg:
                label_parts.append("TRANSPARENT-BG")
            elif has_baked_bg:
                baked_color = img.get("baked_bg_color") or "?"
                if img.get("is_dark_baked_bg"):
                    label_parts.append(f"BAKED-DARK-BG({baked_color})")
                else:
                    label_parts.append(f"BAKED-BG({baked_color})")
            label_parts.append(source_type)
            label = f"({', '.join(label_parts)})" if label_parts else ""

            summaries.append(f"- uuid: {img_uuid} {label}\n  {description}")

        result = f"{total} image(s) available:\n"
        result += "\n".join(summaries)

        if total > limit:
            result += f"\n... and {total - limit} more images"

        result += (
            "\n\nIMPORTANT: Copy the exact 'uuid' values above into the image_references field "
            "of each PageSectionBuildingPlan. Distribute images across sections to use them in "
            "the generated website. These are the user's own images from their uploaded files. "
            "Do NOT invent placeholder names — use the exact UUID strings shown above."
        )

        return result

    # Maps lowercase file extension → canonical original_format token used by
    # the DataIngester. Anything outside this set is recorded as ``unknown`` and
    # filtered out by Layer 2A.
    _FORMAT_BY_EXTENSION = {
        "xlsx": "xlsx",
        "xls": "xls",
        "csv": "csv",
        "tsv": "tsv",
        "docx": "docx",
        "pptx": "pptx",
        "pdf": "pdf",
        "md": "md",
        "markdown": "md",
        "txt": "txt",
    }

    @staticmethod
    def _infer_original_format(source_name: str) -> str:
        """Infer canonical format token from a filename. Used as a fallback when
        the backend hasn't yet populated ``original_mime_type`` (pre-BE-2)."""
        if not source_name or "." not in source_name:
            return "unknown"
        ext = source_name.rsplit(".", 1)[1].lower().strip()
        return DocumentArtifactService._FORMAT_BY_EXTENSION.get(ext, "unknown")

    @staticmethod
    def _compute_doc_artifact_name(source_name: str, content_hash: str) -> str:
        """Recompute the canonical ``doc:{safe}_{hash[:8]}.md`` artifact name
        that ``_prepare_document_artifacts`` / ``_resolve_file_references`` use.
        Lives here so structured_documents keying stays consistent."""
        safe_name = DocumentArtifactService._sanitize_filename(source_name)
        if content_hash:
            return f"doc:{safe_name}_{content_hash[:8]}.md"
        return f"doc:{safe_name}.md"

    @staticmethod
    def _record_structured_document(
        content_context: ContentContext,
        doc_entry: dict,
        artifact_filename: str,
    ) -> None:
        """Populate ``content_context.structured_documents`` from a catalog
        entry if it carries ``has_structured_data: true``. Idempotent — calling
        twice for the same artifact name overwrites; the latest catalog entry
        wins (the catalog is itself deduplicated upstream)."""
        if not doc_entry.get("has_structured_data"):
            return
        content_context.structured_documents[artifact_filename] = {
            "has_structured_data": True,
            "structured_data_sample": doc_entry.get("structured_data_sample"),
            "structured_data_url": doc_entry.get("structured_data_url"),
            "original_mime_type": doc_entry.get("original_mime_type"),
            "original_filename": doc_entry.get("source_name", ""),
            "original_format": DocumentArtifactService._infer_original_format(
                doc_entry.get("source_name", "")
            ),
        }

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """
        Sanitize a filename for use in artifact naming.

        Args:
            name: Original filename

        Returns:
            Sanitized filename safe for artifact storage
        """
        # Remove file extension if present
        if "." in name:
            name = name.rsplit(".", 1)[0]

        # Replace unsafe characters with underscores
        unsafe_chars = ' /\\:*?"<>|'
        for char in unsafe_chars:
            name = name.replace(char, "_")

        # Limit length
        if len(name) > 50:
            name = name[:50]

        # Ensure it's not empty
        if not name:
            name = "document"

        return name.lower()

    @staticmethod
    def _extract_file_references(user_prompt: str) -> list[str]:
        """
        Extract @filename references from user prompt.

        Matches patterns like:
        - @company-logo.png
        - @product-spec.pdf
        - @my_document.docx

        Args:
            user_prompt: User's prompt text

        Returns:
            List of referenced filenames (without @ prefix)
        """
        if not user_prompt:
            return []

        # Match @filename.ext patterns
        # Supports alphanumeric, hyphens, underscores, and common extensions
        # Use negative lookbehind to exclude email addresses (no word char before @)
        pattern = r"(?<![a-zA-Z0-9])@([\w\-]+\.[a-zA-Z0-9]{2,5})"
        matches = re.findall(pattern, user_prompt)

        # Remove duplicates while preserving order
        seen = set()
        unique_refs = []
        for ref in matches:
            ref_lower = ref.lower()
            if ref_lower not in seen:
                seen.add(ref_lower)
                unique_refs.append(ref)

        if unique_refs:
            logger.debug(f"[DocumentArtifactService] Extracted file references: {unique_refs}")

        return unique_refs

    @staticmethod
    def _resolve_file_references(
        user_prompt: str,
        image_catalog: list[dict],
        document_catalog: list[dict],
        content_context: ContentContext,
    ) -> None:
        """
        Extract @filename references from user prompt and resolve to catalog entries.

        Matches referenced filenames to catalog entries by source_name.
        Resolved references are added to content_context with HIGH PRIORITY.

        Args:
            user_prompt: User's prompt text
            image_catalog: List of image entries from catalog
            document_catalog: List of document entries from catalog
            content_context: ContentContext to populate with resolved references
        """
        references = DocumentArtifactService._extract_file_references(user_prompt)

        if not references:
            return

        # Build lookup maps for faster matching
        # Image: source_name/filename -> uuid
        image_map: dict[str, str] = {}
        for img in image_catalog:
            source_name = img.get("source_name", "")
            if source_name:
                # Store both full name and lowercase version
                image_map[source_name.lower()] = img.get("uuid", "")
                # Also try without path (just filename)
                filename = source_name.split("/")[-1].lower()
                if filename not in image_map:
                    image_map[filename] = img.get("uuid", "")

        # Document: source_name/filename -> (artifact_name, is_large, doc_entry)
        # We need to track whether each doc is large to route to the right list
        document_map: dict[str, tuple[str, bool, dict]] = {}
        for doc in document_catalog:
            source_name = doc.get("source_name", "")
            if source_name:
                # Generate the artifact filename with content hash for freshness
                content_hash = doc.get("content_hash", "")
                artifact_filename = DocumentArtifactService._compute_doc_artifact_name(
                    source_name, content_hash
                )

                # Record structured-data metadata for the DataIngester. Mirror
                # of the _prepare_document_artifacts path so @-referenced
                # uploads still surface their structured_data sidecars.
                DocumentArtifactService._record_structured_document(
                    content_context, doc, artifact_filename
                )

                # Check if document is large
                characters_count = doc.get("characters_count", 0)
                is_large = characters_count > DocumentArtifactService.MAX_DOCUMENT_SIZE

                # Store tuple: (artifact_name, is_large, full_doc_entry)
                doc_info = (artifact_filename, is_large, doc)
                document_map[source_name.lower()] = doc_info
                # Also try without path (just filename)
                filename = source_name.split("/")[-1].lower()
                if filename not in document_map:
                    document_map[filename] = doc_info

        # Resolve each reference
        for ref in references:
            ref_lower = ref.lower()

            # Try to match as image
            if ref_lower in image_map:
                uuid = image_map[ref_lower]
                if uuid and uuid not in content_context.user_referenced_images:
                    content_context.user_referenced_images.append(uuid)
                    logger.info(f"[DocumentArtifactService] Resolved @{ref} to image UUID: {uuid}")
                continue

            # Try to match as document
            if ref_lower in document_map:
                artifact_name, is_large, doc_entry = document_map[ref_lower]

                if is_large:
                    # Large document - add to user_referenced_large_documents
                    large_doc_info = {
                        "uuid": doc_entry.get("uuid", ""),
                        "source_name": doc_entry.get("source_name", ""),
                        "summary": _truncate_summary(doc_entry.get("summary", "")),
                    }
                    # Check for duplicates by UUID
                    existing_uuids = [
                        d.get("uuid") for d in content_context.user_referenced_large_documents
                    ]
                    if large_doc_info["uuid"] not in existing_uuids:
                        content_context.user_referenced_large_documents.append(large_doc_info)
                        logger.info(
                            f"[DocumentArtifactService] Resolved @{ref} to LARGE document: {doc_entry.get('source_name')}"
                        )
                else:
                    # Small document - add to user_referenced_documents (artifact names)
                    if (
                        artifact_name
                        and artifact_name not in content_context.user_referenced_documents
                    ):
                        content_context.user_referenced_documents.append(artifact_name)
                        logger.info(
                            f"[DocumentArtifactService] Resolved @{ref} to document artifact: {artifact_name}"
                        )
                continue

            # No match found - track as unresolved reference
            if ref not in content_context.unresolved_references:
                content_context.unresolved_references.append(ref)
            logger.warning(
                f"[DocumentArtifactService] Could not resolve @{ref} to any catalog entry"
            )
