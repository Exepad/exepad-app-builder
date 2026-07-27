"""Integration tests for content handling.

Tests cover:
- Document catalog integration with session state
- Image catalog integration with session state
- Content context preparation with full catalogs
"""

from unittest.mock import AsyncMock, MagicMock
import pytest

# Import the service under test
from main_agent.agents.orchestrator.app_types.shared.services.document_artifact_service import (
    DocumentArtifactService,
)

# Mark all tests in this module as integration tests
pytestmark = [
    pytest.mark.integration,
    pytest.mark.filterwarnings("ignore::DeprecationWarning"),
]


# =============================================================================
# DOCUMENT CATALOG INTEGRATION TESTS
# =============================================================================


class TestDocumentCatalogIntegration:
    """Integration tests for document catalog handling."""

    @pytest.fixture
    def mock_ctx_with_document_catalog(self, sample_document_catalog):
        """Create mock context with document catalog in session state."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.session.state = {
            "document_catalog": sample_document_catalog,
            "image_catalog": [],
        }
        ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_document_catalog_populates_content_context(
        self, mock_ctx_with_document_catalog, sample_document_catalog
    ):
        """Document catalog should be used to prepare content context."""
        # Mock the fetch to succeed for small docs
        with pytest.MonkeyPatch.context() as mp:

            async def mock_fetch(*args, **kwargs):
                return True

            mp.setattr(
                DocumentArtifactService,
                "_fetch_and_save_document",
                mock_fetch,
            )

            result = await DocumentArtifactService.prepare_content_context(
                mock_ctx_with_document_catalog, ""
            )

        # Should have processed small documents as artifacts
        # and large documents in large_document_list
        assert len(result.document_artifact_list) >= 1 or len(result.large_document_list) >= 1

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_small_documents_become_artifacts(self, mock_ctx_with_document_catalog):
        """Small documents (under size limit) should become artifacts."""
        # Mock the fetch to succeed
        with pytest.MonkeyPatch.context() as mp:

            async def mock_fetch(*args, **kwargs):
                return True

            mp.setattr(
                DocumentArtifactService,
                "_fetch_and_save_document",
                mock_fetch,
            )

            result = await DocumentArtifactService.prepare_content_context(
                mock_ctx_with_document_catalog, ""
            )

        # Check that small documents are in artifact list
        # (sample_document_catalog has product-spec.pdf at 5000 chars)
        small_doc_artifacts = [a for a in result.document_artifact_list if "product-spec" in a]
        assert len(small_doc_artifacts) == 1

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_large_documents_marked_for_vertex_search(self, mock_ctx_with_document_catalog):
        """Large documents should be marked for Vertex AI Search."""
        with pytest.MonkeyPatch.context() as mp:

            async def mock_fetch(*args, **kwargs):
                return True

            mp.setattr(
                DocumentArtifactService,
                "_fetch_and_save_document",
                mock_fetch,
            )

            result = await DocumentArtifactService.prepare_content_context(
                mock_ctx_with_document_catalog, ""
            )

        # Check that large documents are in large_document_list
        # (sample_document_catalog has large-manual.pdf at 100000 chars)
        large_docs = [
            d for d in result.large_document_list if "large-manual" in d.get("source_name", "")
        ]
        assert len(large_docs) == 1


# =============================================================================
# IMAGE CATALOG INTEGRATION TESTS
# =============================================================================


class TestImageCatalogIntegration:
    """Integration tests for image catalog handling."""

    @pytest.fixture
    def mock_ctx_with_image_catalog(self, sample_image_catalog):
        """Create mock context with image catalog in session state."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.session.state = {
            "document_catalog": [],
            "image_catalog": sample_image_catalog,
        }
        ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_image_catalog_generates_summary(
        self, mock_ctx_with_image_catalog, sample_image_catalog
    ):
        """Image catalog should generate summary for planner."""
        result = await DocumentArtifactService.prepare_content_context(
            mock_ctx_with_image_catalog, ""
        )

        # Summary should mention the images
        assert result.image_catalog_summary != "No images available."
        # Should contain image UUIDs
        assert "img-uuid-1" in result.image_catalog_summary

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_image_catalog_with_logo_prioritized(self, mock_ctx_with_image_catalog):
        """Logo images should be prioritized in summary."""
        result = await DocumentArtifactService.prepare_content_context(
            mock_ctx_with_image_catalog, ""
        )

        # Logo should appear in summary with LOGO label
        assert "LOGO" in result.image_catalog_summary


# =============================================================================
# CONTENT CONTEXT PREPARATION TESTS
# =============================================================================


class TestContentContextPreparation:
    """Integration tests for full content context preparation."""

    @pytest.fixture
    def mock_ctx_with_both_catalogs(self, sample_document_catalog, sample_image_catalog):
        """Create mock context with both catalogs."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.session.state = {
            "document_catalog": sample_document_catalog,
            "image_catalog": sample_image_catalog,
        }
        ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_prepare_with_both_catalogs(self, mock_ctx_with_both_catalogs):
        """Content context should be prepared with both document and image catalogs."""
        with pytest.MonkeyPatch.context() as mp:

            async def mock_fetch(*args, **kwargs):
                return True

            mp.setattr(
                DocumentArtifactService,
                "_fetch_and_save_document",
                mock_fetch,
            )

            result = await DocumentArtifactService.prepare_content_context(
                mock_ctx_with_both_catalogs, ""
            )

        # Should have document artifacts or large docs
        assert len(result.document_artifact_list) + len(result.large_document_list) > 0
        # Should have image summary
        assert result.image_catalog_summary != "No images available."

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_user_prompt_with_file_references_resolved(self, mock_ctx_with_both_catalogs):
        """User prompt with @filename references should be resolved."""
        with pytest.MonkeyPatch.context() as mp:

            async def mock_fetch(*args, **kwargs):
                return True

            mp.setattr(
                DocumentArtifactService,
                "_fetch_and_save_document",
                mock_fetch,
            )

            result = await DocumentArtifactService.prepare_content_context(
                mock_ctx_with_both_catalogs,
                "Create a website using @company-logo.png and @product-spec.pdf",
            )

        # Image reference should be resolved
        assert "img-uuid-1" in result.user_referenced_images
        # Document reference should be resolved
        assert len(result.user_referenced_documents) >= 1

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_empty_catalogs_handled(self):
        """Empty catalogs should be handled gracefully."""
        ctx = MagicMock()
        ctx.session.id = "test-session"
        ctx.session.user_id = "test-user"
        ctx.session.app_name = "test-app"
        ctx.session.state = {
            "document_catalog": [],
            "image_catalog": [],
        }
        ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])

        result = await DocumentArtifactService.prepare_content_context(ctx, "")

        assert result.document_artifact_list == []
        assert result.large_document_list == []
        assert result.image_catalog_summary == "No images available."

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_unresolved_references_tracked(self, mock_ctx_with_both_catalogs):
        """Unresolved file references should be tracked."""
        result = await DocumentArtifactService.prepare_content_context(
            mock_ctx_with_both_catalogs, "Use @nonexistent-file.xyz in the design"
        )

        # Should track unresolved reference
        assert "nonexistent-file.xyz" in result.unresolved_references
