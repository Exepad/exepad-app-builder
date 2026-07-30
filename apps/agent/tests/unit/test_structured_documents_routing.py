"""Unit tests for the DataIngester routing additions to DocumentArtifactService.

Covers the ``ContentContext.structured_documents`` map and the helpers that
populate it from a ``document_catalog`` entry:

- catalog entry with ``has_structured_data: true`` populates the map
- catalog entry without it leaves the map empty
- ``original_format`` is inferred from filename extension as a fallback
  for pre-BE-2 backends that don't propagate ``original_mime_type``
- @-referenced uploads also populate the map (mirror path)

These are isolated, low-cost tests that do not exercise the LLM agent.
"""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from main_agent.agents.orchestrator.app_types.shared.services.document_artifact_service import (
    ContentContext,
    DocumentArtifactService,
)

pytestmark = pytest.mark.unit


@pytest.fixture
def mock_ctx():
    """Mock invocation context with a stubbed artifact service."""
    ctx = MagicMock()
    ctx.session.id = "test-session"
    ctx.session.user_id = "test-user"
    ctx.session.app_name = "test-app"
    ctx.artifact_service.list_artifact_keys = AsyncMock(return_value=[])
    ctx.artifact_service.save_artifact = AsyncMock()
    return ctx


class TestInferOriginalFormat:
    """Filename → canonical format token mapping."""

    @pytest.mark.parametrize(
        "source_name,expected",
        [
            ("data.xlsx", "xlsx"),
            ("DATA.XLSX", "xlsx"),
            ("legacy.xls", "xls"),
            ("export.csv", "csv"),
            ("export.tsv", "tsv"),
            ("memo.docx", "docx"),
            ("deck.pptx", "pptx"),
            ("spec.pdf", "pdf"),
            ("notes.md", "md"),
            ("readme.markdown", "md"),
            ("plain.txt", "txt"),
        ],
    )
    def test_known_extensions(self, source_name, expected):
        assert DocumentArtifactService._infer_original_format(source_name) == expected

    @pytest.mark.parametrize("source_name", ["no_extension", "", "weird.unknownext", None])
    def test_unknown_or_missing(self, source_name):
        if source_name is None:
            assert DocumentArtifactService._infer_original_format("") == "unknown"
        else:
            assert DocumentArtifactService._infer_original_format(source_name) == "unknown"


class TestRecordStructuredDocument:
    """The shared helper that populates ``structured_documents``."""

    def test_populates_when_has_structured_data_true(self):
        ctx = ContentContext()
        # Mirrors the real backend payload from
        # ``content_service.services.orchestrator._save_structured_data``
        # — always a ``{"sheets": [...]}`` envelope, even for single-sheet
        # xlsx and CSV. The legacy flat ``{"columns": [...]}`` shape is
        # kept working in the extractor for forward-compat but never
        # actually emitted in production.
        doc_entry = {
            "source_name": "sales.xlsx",
            "has_structured_data": True,
            "structured_data_sample": {
                "sheets": [
                    {
                        "sheet_name": "Sheet1",
                        "columns": [{"name": "amount", "type": "real"}],
                        "sample_rows": [{"amount": 99.99}],
                        "total_rows": 1,
                    }
                ],
                "total_sheets": 1,
                "total_rows_all_sheets": 1,
                "file_type": "xlsx",
            },
            "structured_data_url": "https://example.com/sales.jsonl",
            "original_mime_type": (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        }
        DocumentArtifactService._record_structured_document(ctx, doc_entry, "doc:sales_aaaa.md")

        assert "doc:sales_aaaa.md" in ctx.structured_documents
        meta = ctx.structured_documents["doc:sales_aaaa.md"]
        assert meta["has_structured_data"] is True
        assert meta["structured_data_url"] == "https://example.com/sales.jsonl"
        assert meta["original_filename"] == "sales.xlsx"
        assert meta["original_format"] == "xlsx"
        assert meta["original_mime_type"].endswith("sheet")
        assert meta["structured_data_sample"]["sheets"][0]["columns"][0]["name"] == "amount"

    def test_skipped_when_has_structured_data_missing(self):
        ctx = ContentContext()
        DocumentArtifactService._record_structured_document(
            ctx, {"source_name": "memo.txt"}, "doc:memo.md"
        )
        assert ctx.structured_documents == {}

    def test_skipped_when_has_structured_data_false(self):
        ctx = ContentContext()
        DocumentArtifactService._record_structured_document(
            ctx,
            {"source_name": "memo.txt", "has_structured_data": False},
            "doc:memo.md",
        )
        assert ctx.structured_documents == {}

    def test_idempotent_overwrite(self):
        """Calling twice for the same key overwrites — latest entry wins."""
        ctx = ContentContext()
        DocumentArtifactService._record_structured_document(
            ctx,
            {
                "source_name": "sales.xlsx",
                "has_structured_data": True,
                "structured_data_url": "url1",
            },
            "doc:sales_aaaa.md",
        )
        DocumentArtifactService._record_structured_document(
            ctx,
            {
                "source_name": "sales.xlsx",
                "has_structured_data": True,
                "structured_data_url": "url2",
            },
            "doc:sales_aaaa.md",
        )
        assert ctx.structured_documents["doc:sales_aaaa.md"]["structured_data_url"] == "url2"

    def test_pre_be2_backend_no_url_no_mime(self):
        """Pre-BE-2 backend doesn't emit url/mime — fields land as None and the
        format is inferred from filename. DataIngester treats this as 'sidecar
        unavailable' and the doc ends up in failed_artifacts."""
        ctx = ContentContext()
        DocumentArtifactService._record_structured_document(
            ctx,
            {
                "source_name": "data.csv",
                "has_structured_data": True,
                "structured_data_sample": {
                    "sheets": [
                        {"sheet_name": "Sheet1", "columns": [], "sample_rows": [], "total_rows": 0}
                    ],
                    "total_sheets": 1,
                    "file_type": "csv",
                },
                # NB: no structured_data_url, no original_mime_type
            },
            "doc:data_bbbb.md",
        )
        meta = ctx.structured_documents["doc:data_bbbb.md"]
        assert meta["structured_data_url"] is None
        assert meta["original_mime_type"] is None
        assert meta["original_format"] == "csv"


class TestPrepareDocumentArtifactsRouting:
    """Integration: ``_prepare_document_artifacts`` populates the map for both
    small and large catalog entries that carry ``has_structured_data``."""

    @pytest.mark.asyncio
    async def test_small_xlsx_with_sidecar_populates_map(self, mock_ctx):
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "sales.xlsx",
                "content_url": "https://example.com/sales.md",
                "characters_count": 5000,
                "content_hash": "deadbeef",
                "summary": "Sales spreadsheet",
                "has_structured_data": True,
                "structured_data_sample": {
                    "sheets": [
                        {
                            "sheet_name": "Sheet1",
                            "columns": [{"name": "amount"}],
                            "sample_rows": [],
                            "total_rows": 1,
                        }
                    ],
                    "total_sheets": 1,
                    "file_type": "xlsx",
                },
                "structured_data_url": "https://example.com/sales.jsonl",
                "original_mime_type": "application/vnd.ms-excel",
            }
        ]
        ctx = ContentContext()
        with patch.object(
            DocumentArtifactService,
            "_fetch_and_save_document",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await DocumentArtifactService._prepare_document_artifacts(
                mock_ctx, document_catalog, ctx
            )

        # MD artifact created AND structured_documents populated
        assert "doc:sales_deadbeef.md" in ctx.document_artifact_list
        assert "doc:sales_deadbeef.md" in ctx.structured_documents

    @pytest.mark.asyncio
    async def test_large_xlsx_with_sidecar_still_populates_map(self, mock_ctx):
        """A document too big for MD inlining still gets its structured-data
        metadata recorded — the JSONL sidecar is usually much smaller than the
        full MD, so the DataIngester can still work with it."""
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "big.xlsx",
                "content_url": "https://example.com/big.md",
                "characters_count": 500_000,  # too big for MD artifact
                "content_hash": "cafef00d",
                "summary": "Huge spreadsheet",
                "has_structured_data": True,
                "structured_data_url": "https://example.com/big.jsonl",
            }
        ]
        ctx = ContentContext()
        await DocumentArtifactService._prepare_document_artifacts(mock_ctx, document_catalog, ctx)

        # MD goes to large list, but structured_documents still has the entry
        assert any(d["uuid"] == "doc-1" for d in ctx.large_document_list)
        assert "doc:big_cafef00d.md" in ctx.structured_documents

    @pytest.mark.asyncio
    async def test_doc_without_structured_data_leaves_map_empty(self, mock_ctx):
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "memo.md",
                "content_url": "https://example.com/memo.md",
                "characters_count": 2000,
                "content_hash": "1234abcd",
                # NB: no has_structured_data
            }
        ]
        ctx = ContentContext()
        with patch.object(
            DocumentArtifactService,
            "_fetch_and_save_document",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await DocumentArtifactService._prepare_document_artifacts(
                mock_ctx, document_catalog, ctx
            )
        assert ctx.structured_documents == {}

    @pytest.mark.asyncio
    async def test_mixed_catalog(self, mock_ctx):
        """Mixed catalog — only entries with the flag populate the map."""
        document_catalog = [
            {
                "uuid": "d1",
                "source_name": "sales.xlsx",
                "content_url": "u1",
                "characters_count": 3000,
                "content_hash": "aaaa1111",
                "has_structured_data": True,
                "structured_data_url": "u1.jsonl",
            },
            {
                "uuid": "d2",
                "source_name": "spec.pdf",  # pre-BE-1: no sidecar
                "content_url": "u2",
                "characters_count": 3000,
                "content_hash": "bbbb2222",
            },
        ]
        ctx = ContentContext()
        with patch.object(
            DocumentArtifactService,
            "_fetch_and_save_document",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await DocumentArtifactService._prepare_document_artifacts(
                mock_ctx, document_catalog, ctx
            )
        assert list(ctx.structured_documents.keys()) == ["doc:sales_aaaa1111.md"]
        assert ctx.structured_documents["doc:sales_aaaa1111.md"]["original_format"] == "xlsx"


class TestResolveFileReferencesRouting:
    """Mirror path: @-referenced uploads also populate ``structured_documents``."""

    def test_at_reference_populates_map(self):
        image_catalog = []
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "customers.csv",
                "characters_count": 2000,
                "content_hash": "feedface",
                "has_structured_data": True,
                "structured_data_url": "https://example.com/customers.jsonl",
            }
        ]
        ctx = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "Use @customers.csv to seed the table",
            image_catalog,
            document_catalog,
            ctx,
        )
        # The artifact got hooked up via user_referenced_documents
        assert "doc:customers_feedface.md" in ctx.user_referenced_documents
        # AND structured_documents was populated as a side effect
        assert "doc:customers_feedface.md" in ctx.structured_documents
        assert ctx.structured_documents["doc:customers_feedface.md"]["original_format"] == "csv"

    def test_at_reference_without_structured_data_no_pollution(self):
        document_catalog = [
            {
                "uuid": "doc-1",
                "source_name": "memo.docx",
                "characters_count": 2000,
                "content_hash": "abcd1234",
                # no has_structured_data — pre-BE-3 docx
            }
        ]
        ctx = ContentContext()
        DocumentArtifactService._resolve_file_references(
            "Reference @memo.docx",
            [],
            document_catalog,
            ctx,
        )
        assert "doc:memo_abcd1234.md" in ctx.user_referenced_documents
        assert ctx.structured_documents == {}


class TestContentContextDefaultField:
    """Smoke test: the new dataclass field defaults to an empty dict."""

    def test_default_empty(self):
        ctx = ContentContext()
        assert ctx.structured_documents == {}
        assert isinstance(ctx.structured_documents, dict)
