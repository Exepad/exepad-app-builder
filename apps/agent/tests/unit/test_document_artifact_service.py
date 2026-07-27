"""Unit tests for DocumentArtifactService.

Tests cover:
- File reference extraction from user prompts
- File reference resolution to catalogs
- Image catalog summary generation
- Filename sanitization
- Document artifact preparation
- Document fetching with retry logic
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

# Import the service under test
from main_agent.agents.orchestrator.app_types.shared.services.document_artifact_service import (
    DocumentArtifactService,
    ContentContext,
)

# Mark all tests in this module as unit tests
pytestmark = pytest.mark.unit


# =============================================================================
# FILE REFERENCE EXTRACTION TESTS
# =============================================================================


class TestExtractFileReferences:
    """Tests for _extract_file_references method."""

    def test_single_reference(self):
        """Single @filename reference should be extracted."""
        result = DocumentArtifactService._extract_file_references("Use @logo.png for header")
        assert result == ["logo.png"]

    def test_multiple_references(self):
        """Multiple @filename references should be extracted."""
        result = DocumentArtifactService._extract_file_references(
            "Use @hero.jpg and @banner.png in the design"
        )
        assert result == ["hero.jpg", "banner.png"]

    def test_no_match_for_email(self):
        """Email addresses should NOT be matched."""
        result = DocumentArtifactService._extract_file_references("Contact us at email@domain.com")
        assert result == []

    def test_various_extensions(self):
        """Various file extensions should be supported."""
        prompt = "Use @doc.pdf, @image.jpg, @file.docx, @photo.png"
        result = DocumentArtifactService._extract_file_references(prompt)
        assert len(result) == 4
        assert "doc.pdf" in result
        assert "image.jpg" in result
        assert "file.docx" in result
        assert "photo.png" in result

    def test_empty_input(self):
        """Empty string should return empty list."""
        result = DocumentArtifactService._extract_file_references("")
        assert result == []

    def test_none_input(self):
        """None input should return empty list."""
        result = DocumentArtifactService._extract_file_references(None)
        assert result == []

    def test_duplicate_deduplication(self):
        """Duplicate references should be deduplicated."""
        result = DocumentArtifactService._extract_file_references(
            "Use @logo.png first, then @logo.png again"
        )
        assert result == ["logo.png"]

    def test_case_preservation(self):
        """Case should be preserved in extracted names."""
        result = DocumentArtifactService._extract_file_references("Use @MyLogo.PNG")
        assert result == ["MyLogo.PNG"]

    def test_hyphen_underscore_in_filename(self):
        """Filenames with hyphens and underscores should be supported."""
        result = DocumentArtifactService._extract_file_references("Use @my-file_name.pdf")
        assert result == ["my-file_name.pdf"]

    def test_no_extension_not_matched(self):
        """Filenames without extension should not be matched."""
        result = DocumentArtifactService._extract_file_references("Check @noextension here")
        assert result == []

    def test_short_extension(self):
        """Short extensions (2 chars) should be matched."""
        result = DocumentArtifactService._extract_file_references("Use @file.ai")
        assert result == ["file.ai"]


# =============================================================================
# FILE REFERENCE RESOLUTION TESTS
# =============================================================================


class TestResolveFileReferences:
    """Tests for _resolve_file_references method."""

    @pytest.fixture
    def image_catalog(self):
        """Sample image catalog for testing."""
        return [
            {
                "uuid": "img-1",
                "source_name": "company-logo.png",
                "description": "Company logo",
                "url": "https://example.com/logo.png",
            },
            {
                "uuid": "img-2",
                "source_name": "uploads/hero-image.jpg",
                "description": "Hero image",
                "url": "https://example.com/hero.jpg",
            },
        ]

    @pytest.fixture
    def document_catalog(self):
        """Sample document catalog for testing."""
        return [
            {
                "uuid": "doc-1",
                "source_name": "product-spec.pdf",
                "summary": "Product specification",
                "content_url": "https://example.com/spec.md",
                "characters_count": 5000,
                "content_hash": "abc123",
            },
            {
                "uuid": "doc-2",
                "source_name": "large-manual.pdf",
                "summary": "Large manual",
                "content_url": "https://example.com/manual.md",
                "characters_count": 100000,  # Large document
                "content_hash": "xyz789",
            },
        ]

    def test_image_reference_by_full_name(self, image_catalog, document_catalog):
        """Image reference should be resolved by full source_name."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@company-logo.png",
            image_catalog,
            document_catalog,
            content_context,
        )
        assert "img-1" in content_context.user_referenced_images

    def test_image_reference_by_filename_only(self, image_catalog, document_catalog):
        """Image reference should be resolved by filename only (without path)."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@hero-image.jpg",  # Without uploads/ prefix
            image_catalog,
            document_catalog,
            content_context,
        )
        assert "img-2" in content_context.user_referenced_images

    def test_document_reference_small_doc(self, image_catalog, document_catalog):
        """Small document reference should be resolved to artifact name."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@product-spec.pdf",
            image_catalog,
            document_catalog,
            content_context,
        )
        # Should have artifact name with hash suffix
        assert len(content_context.user_referenced_documents) == 1
        assert content_context.user_referenced_documents[0].startswith("doc:product-spec_")

    def test_document_reference_large_doc(self, image_catalog, document_catalog):
        """Large document reference should be added to large documents list."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@large-manual.pdf",
            image_catalog,
            document_catalog,
            content_context,
        )
        assert len(content_context.user_referenced_large_documents) == 1
        assert content_context.user_referenced_large_documents[0]["uuid"] == "doc-2"

    def test_case_insensitive_matching(self, image_catalog, document_catalog):
        """Matching should be case-insensitive."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@COMPANY-LOGO.PNG",
            image_catalog,
            document_catalog,
            content_context,
        )
        assert "img-1" in content_context.user_referenced_images

    def test_unresolved_reference_tracked(self, image_catalog, document_catalog):
        """Unresolved reference should be tracked."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@nonexistent-file.pdf",
            image_catalog,
            document_catalog,
            content_context,
        )
        assert "nonexistent-file.pdf" in content_context.unresolved_references

    def test_mixed_references(self, image_catalog, document_catalog):
        """Mixed image and document references should be resolved."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "Use @company-logo.png and @product-spec.pdf",
            image_catalog,
            document_catalog,
            content_context,
        )
        assert "img-1" in content_context.user_referenced_images
        assert len(content_context.user_referenced_documents) == 1

    def test_empty_catalogs(self):
        """Empty catalogs should result in unresolved references."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "@some-file.png",
            [],
            [],
            content_context,
        )
        assert "some-file.png" in content_context.unresolved_references

    def test_no_references_in_prompt(self, image_catalog, document_catalog):
        """No references should not modify content context."""
        content_context = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "No file references here",
            image_catalog,
            document_catalog,
            content_context,
        )
        assert len(content_context.user_referenced_images) == 0
        assert len(content_context.user_referenced_documents) == 0
        assert len(content_context.unresolved_references) == 0


# =============================================================================
# IMAGE CATALOG SUMMARY TESTS
# =============================================================================


class TestGenerateImageCatalogSummary:
    """Tests for _generate_image_catalog_summary method."""

    def test_empty_catalog(self):
        """Empty catalog should return 'No images available.'"""
        result = DocumentArtifactService._generate_image_catalog_summary([])
        assert result == "No images available."

    def test_user_referenced_images_first(self):
        """User-referenced images should appear first in summary."""
        catalog = [
            {
                "uuid": "img-1",
                "description": "First image",
                "is_logo": False,
                "source_type": "uploaded",
            },
            {
                "uuid": "img-2",
                "description": "Second image",
                "is_logo": False,
                "source_type": "uploaded",
            },
        ]
        result = DocumentArtifactService._generate_image_catalog_summary(
            catalog, user_referenced_images=["img-2"]
        )
        # img-2 should appear before img-1
        idx_img2 = result.find("img-2")
        idx_img1 = result.find("img-1")
        assert idx_img2 < idx_img1

    def test_logo_prioritized_after_user_ref(self):
        """Logo images should be prioritized after user-referenced."""
        catalog = [
            {
                "uuid": "img-1",
                "description": "Regular image",
                "is_logo": False,
                "source_type": "uploaded",
            },
            {
                "uuid": "img-2",
                "description": "Logo image",
                "is_logo": True,
                "source_type": "uploaded",
            },
        ]
        result = DocumentArtifactService._generate_image_catalog_summary(catalog)
        # Logo should appear before regular image
        idx_logo = result.find("img-2")
        idx_regular = result.find("img-1")
        assert idx_logo < idx_regular

    def test_respects_summary_limit(self):
        """Summary should respect IMAGE_CATALOG_SUMMARY_LIMIT."""
        # Create more images than the limit
        catalog = [
            {
                "uuid": f"img-{i}",
                "description": f"Image {i}",
                "is_logo": False,
                "source_type": "uploaded",
            }
            for i in range(20)
        ]
        result = DocumentArtifactService._generate_image_catalog_summary(catalog)
        # Should mention "more images" if truncated
        assert "more images" in result

    def test_description_truncation(self):
        """Long descriptions should be truncated."""
        long_description = "A" * 200  # Very long description
        catalog = [
            {
                "uuid": "img-1",
                "description": long_description,
                "is_logo": False,
                "source_type": "uploaded",
            }
        ]
        result = DocumentArtifactService._generate_image_catalog_summary(catalog)
        # Description should be truncated with ...
        assert "..." in result

    def test_correct_formatting(self):
        """Summary should have correct format with UUID and labels."""
        catalog = [
            {
                "uuid": "img-1",
                "description": "Test image",
                "is_logo": True,
                "source_type": "uploaded",
            }
        ]
        result = DocumentArtifactService._generate_image_catalog_summary(catalog)
        assert "uuid: img-1" in result
        assert "LOGO" in result
        assert "uploaded" in result

    def test_user_ref_label_added(self):
        """USER-REF label should be added for user-referenced images."""
        catalog = [
            {
                "uuid": "img-1",
                "description": "Test image",
                "is_logo": False,
                "source_type": "uploaded",
            }
        ]
        result = DocumentArtifactService._generate_image_catalog_summary(
            catalog, user_referenced_images=["img-1"]
        )
        assert "USER-REF" in result


# =============================================================================
# FILENAME SANITIZATION TESTS
# =============================================================================


class TestSanitizeFilename:
    """Tests for _sanitize_filename method."""

    def test_removes_extension(self):
        """File extension should be removed."""
        result = DocumentArtifactService._sanitize_filename("document.pdf")
        assert "pdf" not in result

    def test_replaces_unsafe_characters(self):
        """Unsafe characters should be replaced with underscores."""
        result = DocumentArtifactService._sanitize_filename("my file:name*.pdf")
        assert " " not in result
        assert ":" not in result
        assert "*" not in result
        assert "_" in result

    def test_lowercases_output(self):
        """Output should be lowercase."""
        result = DocumentArtifactService._sanitize_filename("MyDocument.PDF")
        assert result == result.lower()

    def test_truncates_to_50_chars(self):
        """Filename should be truncated to 50 characters."""
        long_name = "a" * 100 + ".pdf"
        result = DocumentArtifactService._sanitize_filename(long_name)
        assert len(result) <= 50

    def test_empty_returns_document(self):
        """Empty input should return 'document'."""
        result = DocumentArtifactService._sanitize_filename("")
        assert result == "document"

    def test_only_extension_returns_document(self):
        """Input with only extension should return 'document'."""
        result = DocumentArtifactService._sanitize_filename(".pdf")
        assert result == "document"

    def test_preserves_hyphens_underscores(self):
        """Hyphens and underscores should be preserved."""
        result = DocumentArtifactService._sanitize_filename("my-file_name.pdf")
        assert "-" in result
        assert "_" in result


# =============================================================================
# DOCUMENT ARTIFACT PREPARATION TESTS
# =============================================================================


class TestPrepareDocumentArtifacts:
    """Tests for _prepare_document_artifacts method."""

    @pytest.fixture
    def mock_ctx(self):
        """Create mock invocation context."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.asyncio
    async def test_small_document_saved_as_artifact(self, mock_ctx):
        """Small document should be saved as artifact."""
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "small-doc.pdf",
                "content_url": "https://example.com/small.md",
                "characters_count": 5000,
                "content_hash": "abc123",
                "summary": "Small document",
            }
        ]
        content_context = ContentContext()

        with patch.object(
            DocumentArtifactService,
            "_fetch_and_save_document",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await DocumentArtifactService._prepare_document_artifacts(
                mock_ctx, document_catalog, content_context
            )

        assert len(content_context.document_artifact_list) == 1

    @pytest.mark.asyncio
    async def test_large_document_added_to_large_list(self, mock_ctx):
        """Large document should be added to large_document_list."""
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "large-doc.pdf",
                "content_url": "https://example.com/large.md",
                "characters_count": 100000,  # Large document
                "content_hash": "abc123",
                "summary": "Large document",
            }
        ]
        content_context = ContentContext()

        await DocumentArtifactService._prepare_document_artifacts(
            mock_ctx, document_catalog, content_context
        )

        assert len(content_context.large_document_list) == 1
        assert content_context.large_document_list[0]["uuid"] == "doc-1"

    @pytest.mark.asyncio
    async def test_existing_artifact_skipped(self, mock_ctx):
        """Existing artifact should be skipped (deduplication)."""
        mock_ctx.artifact_service.list_artifact_keys = AsyncMock(
            return_value=["doc:small-doc_abc123.md"]
        )
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "small-doc.pdf",
                "content_url": "https://example.com/small.md",
                "characters_count": 5000,
                "content_hash": "abc123",
                "summary": "Small document",
            }
        ]
        content_context = ContentContext()

        # Should not call fetch since artifact exists
        with patch.object(
            DocumentArtifactService,
            "_fetch_and_save_document",
            new_callable=AsyncMock,
        ) as mock_fetch:
            await DocumentArtifactService._prepare_document_artifacts(
                mock_ctx, document_catalog, content_context
            )
            mock_fetch.assert_not_called()

        # Should still be in artifact list
        assert len(content_context.document_artifact_list) == 1

    @pytest.mark.asyncio
    async def test_fetch_failure_falls_back_to_large_list(self, mock_ctx):
        """Fetch failure should fall back to large document list."""
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "small-doc.pdf",
                "content_url": "https://example.com/small.md",
                "characters_count": 5000,
                "content_hash": "abc123",
                "summary": "Small document",
            }
        ]
        content_context = ContentContext()

        with patch.object(
            DocumentArtifactService,
            "_fetch_and_save_document",
            new_callable=AsyncMock,
            return_value=False,  # Fetch fails
        ):
            await DocumentArtifactService._prepare_document_artifacts(
                mock_ctx, document_catalog, content_context
            )

        # Should be in large list as fallback
        assert len(content_context.large_document_list) == 1

    @pytest.mark.asyncio
    async def test_missing_content_url_logged(self, mock_ctx):
        """Missing content_url should be logged as warning."""
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "no-url-doc.pdf",
                "content_url": None,
                "characters_count": 5000,
                "content_hash": "abc123",
                "summary": "Document without URL",
            }
        ]
        content_context = ContentContext()

        await DocumentArtifactService._prepare_document_artifacts(
            mock_ctx, document_catalog, content_context
        )

        # Should not be added to any list
        assert len(content_context.document_artifact_list) == 0
        assert len(content_context.large_document_list) == 0


# =============================================================================
# DOCUMENT FETCHING TESTS
# =============================================================================


class TestFetchAndSaveDocument:
    """Tests for _fetch_and_save_document method."""

    @pytest.fixture
    def mock_ctx(self):
        """Create mock invocation context."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.asyncio
    async def test_successful_fetch_and_save(self, mock_ctx):
        """Successful fetch should save artifact and return True."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "text/markdown"}
        mock_response.charset = "utf-8"
        mock_response.text = AsyncMock(return_value="# Document content")

        # Create async context manager for response
        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        # Create async context manager for session
        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.md", "doc:test.md"
            )

        assert result is True
        mock_ctx.artifact_service.save_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_retry_on_5xx_error(self, mock_ctx):
        """5xx errors should trigger retry."""
        mock_response_500 = MagicMock()
        mock_response_500.status = 500

        mock_response_200 = MagicMock()
        mock_response_200.status = 200
        mock_response_200.headers = {"Content-Type": "text/markdown"}
        mock_response_200.charset = "utf-8"
        mock_response_200.text = AsyncMock(return_value="# Content")

        # Track call count to return different responses
        call_count = [0]

        def get_response_cm(*args, **kwargs):
            call_count[0] += 1
            response = mock_response_500 if call_count[0] == 1 else mock_response_200
            cm = MagicMock()
            cm.__aenter__ = AsyncMock(return_value=response)
            cm.__aexit__ = AsyncMock(return_value=None)
            return cm

        mock_session = MagicMock()
        mock_session.get = MagicMock(side_effect=get_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await DocumentArtifactService._fetch_and_save_document(
                    mock_ctx, "https://example.com/doc.md", "doc:test.md"
                )

        assert result is True

    @pytest.mark.asyncio
    async def test_no_retry_on_4xx_error(self, mock_ctx):
        """4xx errors should not trigger retry."""
        mock_response = MagicMock()
        mock_response.status = 404

        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.md", "doc:test.md"
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_timeout_handling(self, mock_ctx):
        """Timeout should be handled gracefully."""
        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await DocumentArtifactService._fetch_and_save_document(
                    mock_ctx, "https://example.com/doc.md", "doc:test.md"
                )

        assert result is False

    @pytest.mark.asyncio
    async def test_content_type_validation_text(self, mock_ctx):
        """text/* content types should be accepted."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "text/plain"}
        mock_response.charset = "utf-8"
        mock_response.text = AsyncMock(return_value="Plain text content")

        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.txt", "doc:test.md"
            )

        assert result is True

    @pytest.mark.asyncio
    async def test_content_type_validation_json(self, mock_ctx):
        """application/json content type should be accepted."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "application/json"}
        mock_response.charset = "utf-8"
        mock_response.text = AsyncMock(return_value='{"key": "value"}')

        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.json", "doc:test.md"
            )

        assert result is True

    @pytest.mark.asyncio
    async def test_unexpected_content_type_proceeds(self, mock_ctx):
        """Unexpected content type should log warning but proceed."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "application/pdf"}  # Unexpected
        mock_response.charset = "utf-8"
        mock_response.text = AsyncMock(return_value="Some content")

        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.pdf", "doc:test.md"
            )

        # Should still succeed - just logs warning
        assert result is True

    @pytest.mark.asyncio
    async def test_unicode_decode_error_handling(self, mock_ctx):
        """UnicodeDecodeError should be handled gracefully."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "text/plain"}
        mock_response.charset = "utf-8"
        mock_response.text = AsyncMock(side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, ""))

        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.md", "doc:test.md"
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_utf8_encoding_fallback(self, mock_ctx):
        """UTF-8 encoding should be used as fallback."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "text/plain"}
        mock_response.charset = None  # No charset specified
        mock_response.text = AsyncMock(return_value="Content with UTF-8")

        mock_response_cm = MagicMock()
        mock_response_cm.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response_cm.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_response_cm)

        mock_session_cm = MagicMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await DocumentArtifactService._fetch_and_save_document(
                mock_ctx, "https://example.com/doc.md", "doc:test.md"
            )

        assert result is True
        # Verify text() was called with utf-8 encoding
        mock_response.text.assert_called_with(encoding="utf-8")


# =============================================================================
# CONTENT CONTEXT DATACLASS TESTS
# =============================================================================


class TestContentContext:
    """Tests for ContentContext dataclass."""

    def test_default_values(self):
        """ContentContext should have correct default values."""
        ctx = ContentContext()
        assert ctx.document_artifact_list == []
        assert ctx.large_document_list == []
        assert ctx.image_catalog_summary == "No images available."
        assert ctx.user_referenced_images == []
        assert ctx.user_referenced_documents == []
        assert ctx.user_referenced_large_documents == []
        assert ctx.unresolved_references == []

    def test_mutable_lists_independent(self):
        """Mutable list defaults should be independent between instances."""
        ctx1 = ContentContext()
        ctx2 = ContentContext()
        ctx1.document_artifact_list.append("doc1")
        assert "doc1" not in ctx2.document_artifact_list


# =============================================================================
# PREPARE CONTENT CONTEXT INTEGRATION TESTS
# =============================================================================


class TestPrepareContentContext:
    """Integration tests for prepare_content_context method."""

    @pytest.fixture
    def mock_ctx(self):
        """Create mock invocation context with catalogs."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.session.state = {
            "document_catalog": [],
            "image_catalog": [],
        }
        ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.asyncio
    async def test_empty_catalogs(self, mock_ctx):
        """Empty catalogs should return default content context."""
        result = await DocumentArtifactService.prepare_content_context(mock_ctx, "")
        assert result.image_catalog_summary == "No images available."
        assert result.document_artifact_list == []

    @pytest.mark.asyncio
    async def test_with_image_catalog(self, mock_ctx):
        """Image catalog should generate summary."""
        mock_ctx.session.state["image_catalog"] = [
            {
                "uuid": "img-1",
                "description": "Test image",
                "is_logo": False,
                "source_type": "uploaded",
            }
        ]
        result = await DocumentArtifactService.prepare_content_context(mock_ctx, "")
        assert "img-1" in result.image_catalog_summary

    @pytest.mark.asyncio
    async def test_with_user_prompt_references(self, mock_ctx):
        """User prompt with @filename should resolve references."""
        mock_ctx.session.state["image_catalog"] = [
            {
                "uuid": "img-1",
                "source_name": "logo.png",
                "description": "Logo",
                "is_logo": True,
                "source_type": "uploaded",
            }
        ]
        result = await DocumentArtifactService.prepare_content_context(
            mock_ctx, "Use @logo.png for the header"
        )
        assert "img-1" in result.user_referenced_images
