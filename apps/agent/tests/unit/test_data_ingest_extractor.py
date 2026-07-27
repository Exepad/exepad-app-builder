"""Unit tests for the DataIngester Layer 2A (sidecar fetcher).

Trivial scope by design — only HTTP, naming, and I/O surfaces. The agent
never parses file content, so there's no MD parsing / type inference /
overlap math here.
"""

from __future__ import annotations

import ipaddress
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from main_agent.agents.orchestrator.app_types.shared.services.document_artifact_service import (
    ContentContext,
)
from main_agent.agents.orchestrator.app_types.webapp.services.data_ingest_extractor import (
    _canonical_type,
    _columns_from_rows,
    _columns_from_sample,
    _filename_stem,
    _partition_rows_by_sheet,
    _sheets_from_sample,
    extract_all,
    fetch_jsonl_sidecar,
    save_extracted_artifacts,
    snake_case_namer,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.data_ingester import (
    ProposedColumn,
    ProposedModel,
)

pytestmark = pytest.mark.unit


# A routable, public IPv4 the SSRF guard must accept. Never actually contacted —
# every fetch in this module goes through a mocked ``aiohttp.ClientSession``.
_PUBLIC_IP = "93.184.216.34"


async def _offline_getaddrinfo(host: str) -> list[str]:
    """Faithful, network-free stand-in for ``url_guard._resolve``.

    Mirrors the two behaviours of the real ``loop.getaddrinfo`` that the guard
    depends on:

    * an IP literal resolves to itself (``getaddrinfo("127.0.0.1")`` really does
      return ``["127.0.0.1"]``) — so internal literals stay blocked here exactly
      as they are in production;
    * any other name resolves to a single public address, standing in for the
      signed sidecar host these tests pretend to fetch from.
    """
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return [_PUBLIC_IP]
    return [host]


@pytest.fixture(autouse=True)
def stub_dns_resolution():
    """Keep the SSRF guard ACTIVE but make DNS hermetic.

    ``fetch_jsonl_sidecar`` runs every sidecar URL through
    ``main_agent.net.url_guard.assert_safe_url``, which resolves the hostname
    and rejects anything landing on a private / loopback / link-local /
    metadata address. These tests use the fake host ``http://test/...`` with a
    mocked aiohttp layer, so a *real* ``getaddrinfo`` would both touch the
    network and hard-fail on a sandbox with no DNS ("Temporary failure in name
    resolution"). Resolution failure fails closed, so every fetch turned into a
    blocked-URL ``ClientError`` and the suite only passed on a machine with
    working DNS.

    We patch only the resolver seam (``url_guard._resolve``, which the guard
    documents as "patchable seam for tests") and emulate ``getaddrinfo``. The
    guard itself is untouched: scheme enforcement, host extraction, IP-literal
    classification and the resolved-address block-list all still run on every
    URL under test. ``TestSsrfGuardStillBlocks`` below pins that this is a
    seam, not a bypass.
    """
    with patch(
        "main_agent.net.url_guard._resolve",
        new=AsyncMock(side_effect=_offline_getaddrinfo),
    ) as resolver:
        yield resolver


# =============================================================================
# snake_case_namer — collision suffix, Unicode handling, fallback
# =============================================================================


class TestSnakeCaseNamer:
    def test_basic_snake_case(self):
        used: set[str] = set()
        assert snake_case_namer("Customer Email", used) == "customer_email"
        assert "customer_email" in used

    def test_collision_suffix(self):
        used: set[str] = set()
        assert snake_case_namer("email", used) == "email"
        assert snake_case_namer("Email", used) == "email_2"
        assert snake_case_namer("EMAIL", used) == "email_3"

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Müşteri ID", "musteri_id"),  # Turkish ş + ı → s + i (manual override)
            ("café", "cafe"),  # NFKD strips combining acute
            ("Größe", "grosse"),  # ß → ss
            ("Wrocław", "wroclaw"),  # ł → l
            ("résumé", "resume"),
        ],
    )
    def test_diacritic_folding(self, raw, expected):
        used: set[str] = set()
        assert snake_case_namer(raw, used) == expected

    def test_leading_digit_prefix(self):
        used: set[str] = set()
        # SQL identifiers can't start with a digit.
        assert snake_case_namer("2025 Sales", used) == "n_2025_sales"

    def test_punctuation_collapsed(self):
        used: set[str] = set()
        assert snake_case_namer("q1'25 (sales $)", used) == "q1_25_sales"

    def test_empty_falls_back(self):
        used: set[str] = set()
        # Non-Latin-only header strips to empty → col_1 fallback.
        assert snake_case_namer("中文", used, fallback_prefix="col") == "col_1"
        assert snake_case_namer("漢字", used, fallback_prefix="col") == "col_2"

    def test_empty_string_input(self):
        used: set[str] = set()
        assert snake_case_namer("", used).startswith("col_")
        assert snake_case_namer(None, used).startswith("col_")  # type: ignore[arg-type]


# =============================================================================
# fetch_jsonl_sidecar — mocked aiohttp, row cap, retries
# =============================================================================


class _MockResponse:
    """Async-iterable response mock that matches the subset of aiohttp's
    surface ``fetch_jsonl_sidecar`` uses."""

    def __init__(self, status: int, lines: list[str], *, headers: dict | None = None):
        self.status = status
        self._lines = lines
        self.request_info = SimpleNamespace(real_url="http://test/sidecar")
        self.history = ()
        self.headers = headers or {}

        class _Content:
            def __init__(self, lines_inner: list[str]) -> None:
                self._lines = [
                    (line if line.endswith("\n") else line + "\n").encode("utf-8")
                    for line in lines_inner
                ]

            def __aiter__(self):
                return self._async_gen()

            async def _async_gen(self):
                for chunk in self._lines:
                    yield chunk

        self.content = _Content(lines)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc_info):
        return False


class _MockClientSession:
    def __init__(self, response: _MockResponse):
        self._response = response
        self.get_kwargs: dict = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc_info):
        return False

    def get(self, url, timeout=None, allow_redirects=True):
        # ``allow_redirects`` is part of the production call signature: the SSRF
        # guard is only sound if redirects are NOT auto-followed (an allowed host
        # could 302 to an internal target). Recorded so a test can assert it.
        self.get_kwargs = {
            "url": url,
            "timeout": timeout,
            "allow_redirects": allow_redirects,
        }
        return self._response


class TestFetchJsonlSidecar:
    @pytest.mark.asyncio
    async def test_happy_path(self):
        lines = [
            json.dumps({"id": 1, "name": "Alice"}),
            json.dumps({"id": 2, "name": "Bob"}),
        ]
        response = _MockResponse(200, lines)
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(response),
        ):
            rows, row_cap_hit = await fetch_jsonl_sidecar("http://test/sidecar")
        assert len(rows) == 2
        assert rows[0]["name"] == "Alice"
        assert row_cap_hit is False

    @pytest.mark.asyncio
    async def test_row_cap_clips_and_flags(self):
        lines = [json.dumps({"id": i}) for i in range(10)]
        response = _MockResponse(200, lines)
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(response),
        ):
            rows, row_cap_hit = await fetch_jsonl_sidecar("http://test/sidecar", row_cap=3)
        assert len(rows) == 3
        assert row_cap_hit is True

    @pytest.mark.asyncio
    async def test_blank_lines_tolerated(self):
        lines = ["", json.dumps({"id": 1}), "", "", json.dumps({"id": 2})]
        response = _MockResponse(200, lines)
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(response),
        ):
            rows, _ = await fetch_jsonl_sidecar("http://test/sidecar")
        assert len(rows) == 2

    @pytest.mark.asyncio
    async def test_malformed_line_logged_and_skipped(self):
        lines = ["{not json", json.dumps({"id": 1})]
        response = _MockResponse(200, lines)
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(response),
        ):
            rows, _ = await fetch_jsonl_sidecar("http://test/sidecar")
        assert rows == [{"id": 1}]

    @pytest.mark.asyncio
    async def test_4xx_bubbles_up_as_client_error(self):
        response = _MockResponse(404, [])
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(response),
        ):
            with pytest.raises(aiohttp.ClientResponseError) as exc_info:
                await fetch_jsonl_sidecar("http://test/sidecar", max_retries=0)
        # Assert on the *response* error specifically: a bare ClientError check
        # would also be satisfied by the SSRF guard rejecting the URL, which is
        # a different code path and would silently hide a broken 4xx branch.
        assert exc_info.value.status == 404

    @pytest.mark.asyncio
    async def test_redirects_are_not_followed(self):
        """The SSRF guard only holds if redirects aren't auto-followed —
        a public host can 302 to ``169.254.169.254``. Pin the call kwarg."""
        session = _MockClientSession(_MockResponse(200, [json.dumps({"id": 1})]))
        with patch("aiohttp.ClientSession", return_value=session):
            await fetch_jsonl_sidecar("http://test/sidecar")
        assert session.get_kwargs["allow_redirects"] is False


class TestSsrfGuardStillBlocks:
    """The ``stub_dns_resolution`` fixture replaces the resolver, NOT the
    guard. These cases prove the security control is still enforced inside
    ``fetch_jsonl_sidecar`` — none of them touch the network."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:8080/steal.jsonl",  # loopback literal
            "http://169.254.169.254/latest/meta-data/",  # cloud metadata
            "http://10.0.0.5/internal.jsonl",  # RFC1918
            "http://[::1]/steal.jsonl",  # IPv6 loopback
            "file:///etc/passwd",  # non-http scheme
        ],
    )
    async def test_internal_targets_rejected(self, url):
        # IP-literal URLs never reach the resolver seam at all, so this is the
        # real production guard running unmodified.
        session = _MockClientSession(_MockResponse(200, [json.dumps({"id": 1})]))
        with patch("aiohttp.ClientSession", return_value=session):
            with pytest.raises(aiohttp.ClientError, match="blocked unsafe sidecar URL"):
                await fetch_jsonl_sidecar(url, max_retries=0)
        # Never even opened a connection.
        assert session.get_kwargs == {}

    @pytest.mark.asyncio
    async def test_hostname_resolving_to_private_ip_rejected(self):
        """DNS-rebind shape: a public-looking name that resolves internally.
        Proves the guard inspects what the resolver hands back rather than
        trusting the hostname."""
        session = _MockClientSession(_MockResponse(200, [json.dumps({"id": 1})]))
        with patch(
            "main_agent.net.url_guard._resolve",
            new=AsyncMock(return_value=["10.1.2.3"]),
        ):
            with patch("aiohttp.ClientSession", return_value=session):
                with pytest.raises(aiohttp.ClientError, match="blocked unsafe sidecar URL"):
                    await fetch_jsonl_sidecar("http://evil.example.com/x.jsonl", max_retries=0)
        assert session.get_kwargs == {}


# =============================================================================
# Schema helpers
# =============================================================================


class TestColumnsFromSample:
    """``_columns_from_sample`` is the legacy single-sheet shim — it returns
    the FIRST sheet's columns. ``_sheets_from_sample`` (tested below) is
    the multi-sheet entry point used by ``extract_all``."""

    def test_backend_sheets_shape(self):
        # The shape the backend actually emits — ``_columns_from_sample``
        # returns the first sheet's columns for legacy callers.
        sample = {
            "sheets": [
                {
                    "sheet_name": "Sheet1",
                    "columns": [{"name": "amount", "type": "real"}],
                    "sample_rows": [{"amount": 9.99}],
                    "total_rows": 1,
                }
            ],
            "total_sheets": 1,
            "file_type": "xlsx",
        }
        assert _columns_from_sample(sample) == [{"name": "amount", "type": "real"}]

    def test_legacy_dict_columns_shape(self):
        # Pre-BE-2 / pre-multi-sheet fallback — still honoured.
        sample = {"columns": [{"name": "amount", "type": "real"}]}
        assert _columns_from_sample(sample) == [{"name": "amount", "type": "real"}]

    def test_legacy_flat_list_shape(self):
        assert _columns_from_sample([{"name": "x"}]) == [{"name": "x"}]

    def test_unknown_shape_returns_empty(self):
        assert _columns_from_sample("not a dict") == []
        assert _columns_from_sample(None) == []


class TestSheetsFromSample:
    """Multi-sheet aware normaliser — the new contract for ``extract_all``."""

    def test_backend_multi_sheet_shape(self):
        sample = {
            "sheets": [
                {"sheet_name": "Customers", "columns": [{"name": "id", "type": "integer"}]},
                {"sheet_name": "Orders", "columns": [{"name": "order_id", "type": "integer"}]},
            ],
            "total_sheets": 2,
            "file_type": "xlsx",
        }
        sheets = _sheets_from_sample(sample)
        assert [s["sheet_name"] for s in sheets] == ["Customers", "Orders"]
        assert sheets[0]["columns"][0]["name"] == "id"

    def test_legacy_flat_shape_wrapped_as_single_sheet(self):
        sample = {"columns": [{"name": "amount", "type": "real"}]}
        sheets = _sheets_from_sample(sample)
        assert len(sheets) == 1
        assert sheets[0]["sheet_name"] == "Sheet1"
        assert sheets[0]["columns"] == [{"name": "amount", "type": "real"}]

    def test_bare_list_wrapped_as_single_sheet(self):
        sheets = _sheets_from_sample([{"name": "x", "type": "text"}])
        assert len(sheets) == 1
        assert sheets[0]["columns"] == [{"name": "x", "type": "text"}]

    def test_missing_sheet_name_synthesised(self):
        sample = {"sheets": [{"columns": [{"name": "x"}]}, {"columns": [{"name": "y"}]}]}
        sheets = _sheets_from_sample(sample)
        assert [s["sheet_name"] for s in sheets] == ["Sheet1", "Sheet2"]

    def test_unknown_shape_returns_empty(self):
        assert _sheets_from_sample(None) == []
        assert _sheets_from_sample("not a dict") == []
        assert _sheets_from_sample({}) == []


class TestColumnsFromRows:
    def test_union_of_keys(self):
        rows = [{"a": 1}, {"a": 2, "b": 3}, {"c": 4}]
        cols = _columns_from_rows(rows)
        names = [c["name"] for c in cols]
        assert names == ["a", "b", "c"]
        assert all(c["type"] == "text" for c in cols)

    def test_empty_rows(self):
        assert _columns_from_rows([]) == []

    def test_sheet_marker_filtered(self):
        # Defence: even if a row-key fallback runs on a backend-tagged
        # JSONL stream, the synthetic ``_sheet`` discriminator must not
        # surface as a real column.
        rows = [{"_sheet": "Customers", "email": "a@x"}]
        cols = _columns_from_rows(rows)
        assert [c["name"] for c in cols] == ["email"]


class TestPartitionRowsBySheet:
    def test_groups_and_strips_marker(self):
        rows = [
            {"_sheet": "Customers", "id": 1, "email": "a@x"},
            {"_sheet": "Orders", "order_id": 1, "total": 99.0},
            {"_sheet": "Customers", "id": 2, "email": "b@x"},
        ]
        grouped = _partition_rows_by_sheet(rows, ["Customers", "Orders"])
        assert list(grouped.keys()) == ["Customers", "Orders"]
        assert len(grouped["Customers"]) == 2
        assert "_sheet" not in grouped["Customers"][0]
        assert grouped["Customers"][0] == {"id": 1, "email": "a@x"}
        assert grouped["Orders"][0] == {"order_id": 1, "total": 99.0}

    def test_unknown_sheet_dropped(self):
        rows = [{"_sheet": "Ghost", "x": 1}, {"_sheet": "Customers", "x": 2}]
        grouped = _partition_rows_by_sheet(rows, ["Customers"])
        assert grouped["Customers"] == [{"x": 2}]

    def test_missing_marker_dropped(self):
        rows = [{"x": 1}, {"_sheet": "Customers", "x": 2}]
        grouped = _partition_rows_by_sheet(rows, ["Customers"])
        assert grouped["Customers"] == [{"x": 2}]


class TestCanonicalType:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("integer", "integer"),
            ("INT", "integer"),
            ("bigint", "integer"),
            ("real", "real"),
            ("float", "real"),
            ("text", "text"),
            ("string", "text"),
            ("date", "text"),  # D1 has no DATE; ISO 8601 strings
            ("datetime", "text"),
            ("json", "json"),
            ("boolean", "integer"),
            ("bool", "integer"),
            (None, "text"),
            ("weirdtype", "text"),
        ],
    )
    def test_mapping(self, raw, expected):
        assert _canonical_type(raw) == expected


class TestFilenameStem:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("sales.xlsx", "sales"),
            ("path/to/customers.csv", "customers"),
            ("no_extension", "no_extension"),
            ("multi.part.name.pdf", "multi.part.name"),
        ],
    )
    def test_stem_strip(self, raw, expected):
        assert _filename_stem(raw) == expected


# =============================================================================
# save_extracted_artifacts — artifact I/O
# =============================================================================


class TestSaveExtractedArtifacts:
    @pytest.fixture
    def mock_ctx(self):
        ctx = MagicMock()
        ctx.session.id = "s1"
        ctx.session.user_id = "u1"
        ctx.session.app_name = "app1"
        ctx.artifact_service.save_artifact = AsyncMock()
        return ctx

    @pytest.mark.asyncio
    async def test_writes_two_artifacts_per_model(self, mock_ctx):
        model = ProposedModel(
            name="customers",
            source_artifact="doc:customers.md",
            columns=[
                ProposedColumn(name="email", original_name="Email", type="text", nullable=False),
            ],
            row_count=2,
        )
        rows = [{"email": "a@x"}, {"email": "b@x"}]
        await save_extracted_artifacts(mock_ctx, [model], {"customers": rows})

        calls = mock_ctx.artifact_service.save_artifact.call_args_list
        filenames = [c.kwargs["filename"] for c in calls]
        assert "extracted_rows:customers.json" in filenames
        assert "extracted_schema:customers.json" in filenames

        # Verify schema payload retains type + nullable + original_name,
        # AND emits ``required`` (== not nullable) so the bridge's
        # ``_build_extracted_seed_dataset`` can read it directly. Both
        # fields are written; ``nullable`` is debug-only provenance,
        # ``required`` is the load-bearing contract.
        schema_call = next(
            c for c in calls if c.kwargs["filename"] == "extracted_schema:customers.json"
        )
        artifact = schema_call.kwargs["artifact"]
        payload = json.loads(artifact.inline_data.data.decode("utf-8"))
        assert payload["name"] == "customers"
        assert payload["columns"] == [
            {
                "name": "email",
                "type": "text",
                "required": True,
                "nullable": False,
                "original_name": "Email",
            }
        ]


# =============================================================================
# extract_all — integration over multiple structured documents
# =============================================================================


@pytest.fixture
def mock_ctx():
    ctx = MagicMock()
    ctx.session.id = "s1"
    ctx.session.user_id = "u1"
    ctx.session.app_name = "app1"
    ctx.artifact_service.save_artifact = AsyncMock()
    return ctx


class TestExtractAll:
    @pytest.mark.asyncio
    async def test_no_structured_documents_returns_empty(self, mock_ctx):
        ctx_content = ContentContext()
        models, failed, warnings = await extract_all(mock_ctx, ctx_content)
        assert models == []
        assert failed == []
        assert warnings == []

    @pytest.mark.asyncio
    async def test_missing_sidecar_url_recorded_as_failed(self, mock_ctx):
        ctx_content = ContentContext()
        ctx_content.structured_documents["doc:sales.md"] = {
            "has_structured_data": True,
            "structured_data_sample": {
                "sheets": [
                    {"sheet_name": "Sheet1", "columns": [], "sample_rows": [], "total_rows": 0}
                ],
                "total_sheets": 1,
                "file_type": "xlsx",
            },
            "structured_data_url": None,
            "original_filename": "sales.xlsx",
            "original_format": "xlsx",
        }
        models, failed, warnings = await extract_all(mock_ctx, ctx_content)
        assert models == []
        assert failed == ["doc:sales.md"]

    @pytest.mark.asyncio
    async def test_happy_path_one_model(self, mock_ctx):
        # Backend shape: one ``{"sheets": [...]}`` envelope even for a
        # single-sheet xlsx. Multi-sheet → multi-model is covered in
        # ``test_multi_sheet_xlsx_splits_into_n_models``.
        ctx_content = ContentContext()
        ctx_content.structured_documents["doc:sales_aaaa.md"] = {
            "has_structured_data": True,
            "structured_data_sample": {
                "sheets": [
                    {
                        "sheet_name": "Sheet1",
                        "columns": [
                            {"name": "Order ID", "type": "integer"},
                            {"name": "Amount", "type": "real"},
                        ],
                        "sample_rows": [],
                        "total_rows": 2,
                    }
                ],
                "total_sheets": 1,
                "file_type": "xlsx",
            },
            "structured_data_url": "http://test/sales.jsonl",
            "original_filename": "sales.xlsx",
            "original_format": "xlsx",
        }
        lines = [
            json.dumps({"_sheet": "Sheet1", "Order ID": 1, "Amount": 99.5}),
            json.dumps({"_sheet": "Sheet1", "Order ID": 2, "Amount": 42.0}),
        ]
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(_MockResponse(200, lines)),
        ):
            models, failed, warnings = await extract_all(mock_ctx, ctx_content)

        assert failed == []
        assert warnings == []
        assert len(models) == 1
        model = models[0]
        assert model.name == "sales"
        # Columns are snake-cased; originals preserved.
        assert [c.name for c in model.columns] == ["order_id", "amount"]
        assert model.columns[0].original_name == "Order ID"
        # Type tokens mapped to D1 canonical.
        assert model.columns[0].type == "integer"
        assert model.columns[1].type == "real"
        assert model.row_count == 2
        assert model.row_cap_hit is False
        assert model.target_mode == "create"

        # Artifacts saved.
        save_calls = mock_ctx.artifact_service.save_artifact.call_args_list
        filenames = [c.kwargs["filename"] for c in save_calls]
        assert "extracted_rows:sales.json" in filenames
        assert "extracted_schema:sales.json" in filenames

        # Rows were re-keyed to canonical column names.
        rows_call = next(
            c for c in save_calls if c.kwargs["filename"] == "extracted_rows:sales.json"
        )
        rows_payload = json.loads(rows_call.kwargs["artifact"].inline_data.data.decode("utf-8"))
        assert rows_payload[0]["order_id"] == 1
        assert rows_payload[0]["amount"] == 99.5
        # The backend tags every row with ``_sheet`` even on single-sheet
        # uploads. The single-sheet path must strip it just like the
        # multi-sheet path does, or it leaks into the seed artifact and
        # downstream D1 schema generation could treat it as a real column.
        assert "_sheet" not in rows_payload[0]

    @pytest.mark.asyncio
    async def test_row_cap_emits_warning(self, mock_ctx):
        ctx_content = ContentContext()
        ctx_content.structured_documents["doc:big.md"] = {
            "has_structured_data": True,
            "structured_data_sample": {
                "sheets": [
                    {
                        "sheet_name": "Sheet1",
                        "columns": [{"name": "id", "type": "integer"}],
                        "sample_rows": [],
                        "total_rows": 100,
                    }
                ],
                "total_sheets": 1,
                "file_type": "xlsx",
            },
            "structured_data_url": "http://test/big.jsonl",
            "original_filename": "big.xlsx",
            "original_format": "xlsx",
        }
        lines = [json.dumps({"_sheet": "Sheet1", "id": i}) for i in range(100)]
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services.data_ingest_extractor.DATA_INGEST_ROW_CAP",
            5,
        ):
            with patch(
                "aiohttp.ClientSession",
                return_value=_MockClientSession(_MockResponse(200, lines)),
            ):
                models, failed, warnings = await extract_all(mock_ctx, ctx_content)

        assert len(models) == 1
        assert models[0].row_count == 5
        assert models[0].row_cap_hit is True
        assert any("row count exceeds" in w for w in warnings)

    @pytest.mark.asyncio
    async def test_collision_suffix_on_duplicate_filenames(self, mock_ctx):
        """Two uploads with the same stem produce ``sales`` + ``sales_2``."""
        ctx_content = ContentContext()
        for suffix in ("a", "b"):
            ctx_content.structured_documents[f"doc:sales_{suffix}.md"] = {
                "has_structured_data": True,
                "structured_data_sample": {
                    "sheets": [
                        {
                            "sheet_name": "Sheet1",
                            "columns": [{"name": "x", "type": "text"}],
                            "sample_rows": [],
                            "total_rows": 1,
                        }
                    ],
                    "total_sheets": 1,
                    "file_type": "xlsx",
                },
                "structured_data_url": f"http://test/{suffix}.jsonl",
                "original_filename": "sales.xlsx",
                "original_format": "xlsx",
            }
        lines = [json.dumps({"_sheet": "Sheet1", "x": "hello"})]
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(_MockResponse(200, lines)),
        ):
            models, _, _ = await extract_all(mock_ctx, ctx_content)
        assert {m.name for m in models} == {"sales", "sales_2"}

    @pytest.mark.asyncio
    async def test_fetch_error_records_failed(self, mock_ctx):
        ctx_content = ContentContext()
        ctx_content.structured_documents["doc:sales.md"] = {
            "has_structured_data": True,
            "structured_data_sample": {
                "sheets": [
                    {
                        "sheet_name": "Sheet1",
                        "columns": [{"name": "x"}],
                        "sample_rows": [],
                        "total_rows": 0,
                    }
                ],
                "total_sheets": 1,
                "file_type": "xlsx",
            },
            "structured_data_url": "http://test/sales.jsonl",
            "original_filename": "sales.xlsx",
        }

        async def _explode(*_a, **_kw):
            raise aiohttp.ClientError("connection refused")

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services.data_ingest_extractor.fetch_jsonl_sidecar",
            side_effect=_explode,
        ):
            models, failed, _ = await extract_all(mock_ctx, ctx_content)

        assert models == []
        assert failed == ["doc:sales.md"]

    @pytest.mark.asyncio
    async def test_falls_back_to_row_key_inference_when_sample_empty(self, mock_ctx):
        ctx_content = ContentContext()
        ctx_content.structured_documents["doc:sales.md"] = {
            "has_structured_data": True,
            "structured_data_sample": {},  # no sheets / no columns
            "structured_data_url": "http://test/sales.jsonl",
            "original_filename": "sales.xlsx",
            "original_format": "xlsx",
        }
        # No ``_sheet`` marker — pre-BE-2 backend payload, single-sheet
        # fallback. Row-key inference picks up ``foo`` and ``bar``.
        lines = [json.dumps({"foo": 1, "bar": "x"})]
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(_MockResponse(200, lines)),
        ):
            models, _, _ = await extract_all(mock_ctx, ctx_content)
        assert len(models) == 1
        assert {c.name for c in models[0].columns} == {"foo", "bar"}

    @pytest.mark.asyncio
    async def test_multi_sheet_xlsx_splits_into_n_models(self, mock_ctx):
        """Canary for R1 + R2 + R3 + R6 (Fix 4):

        Backend emits ``{"sheets": [...]}`` with N sheets and one merged
        JSONL where each row carries a ``_sheet`` marker. ``extract_all``
        must:

        * produce N ``ProposedModel`` records named ``{stem}_{sheet}`` —
          one per data sheet (R1, R2);
        * preserve the backend's typed columns — not collapse to text (R1);
        * partition rows by ``_sheet`` and never leak ``_sheet`` as a
          column (R3);
        * skip the 1-column README-style sheet in a multi-sheet upload (R6).
        """
        ctx_content = ContentContext()
        ctx_content.structured_documents["doc:business_aaaa.md"] = {
            "has_structured_data": True,
            "structured_data_sample": {
                "sheets": [
                    # README: 1 column → must be filtered (Fix 4).
                    {
                        "sheet_name": "README",
                        "columns": [{"name": "About", "type": "string"}],
                        "sample_rows": [{"About": "Fixture for testing"}],
                        "total_rows": 3,
                    },
                    {
                        "sheet_name": "Customers",
                        "columns": [
                            {"name": "customer_id", "type": "integer"},
                            {"name": "first_name", "type": "string"},
                            {"name": "lifetime_value", "type": "decimal"},
                        ],
                        "sample_rows": [],
                        "total_rows": 2,
                    },
                    {
                        "sheet_name": "Orders",
                        "columns": [
                            {"name": "order_id", "type": "integer"},
                            {"name": "customer_id", "type": "integer"},
                            {"name": "total", "type": "decimal"},
                        ],
                        "sample_rows": [],
                        "total_rows": 2,
                    },
                ],
                "total_sheets": 3,
                "file_type": "xlsx",
            },
            "structured_data_url": "http://test/business.jsonl",
            "original_filename": "business.xlsx",
            "original_format": "xlsx",
        }
        lines = [
            # README rows — should not reach any ProposedModel.
            json.dumps({"_sheet": "README", "About": "Fixture for testing"}),
            # Customer rows.
            json.dumps(
                {
                    "_sheet": "Customers",
                    "customer_id": 1,
                    "first_name": "Ada",
                    "lifetime_value": 99.5,
                }
            ),
            json.dumps(
                {
                    "_sheet": "Customers",
                    "customer_id": 2,
                    "first_name": "Liam",
                    "lifetime_value": 250.0,
                }
            ),
            # Order rows.
            json.dumps({"_sheet": "Orders", "order_id": 100, "customer_id": 1, "total": 12.5}),
            json.dumps({"_sheet": "Orders", "order_id": 101, "customer_id": 2, "total": 88.0}),
        ]
        with patch(
            "aiohttp.ClientSession",
            return_value=_MockClientSession(_MockResponse(200, lines)),
        ):
            models, failed, warnings = await extract_all(mock_ctx, ctx_content)

        assert failed == []
        # README has 1 column → filtered out (Fix 4). Two data sheets remain.
        assert {m.name for m in models} == {"business_customers", "business_orders"}
        # Single source artifact for both — audit trail intentionally shared.
        assert {m.source_artifact for m in models} == {"doc:business_aaaa.md"}

        customers = next(m for m in models if m.name == "business_customers")
        orders = next(m for m in models if m.name == "business_orders")

        # Backend types survive end-to-end (R1).
        cust_types = {c.name: c.type for c in customers.columns}
        assert cust_types == {
            "customer_id": "integer",
            "first_name": "text",
            "lifetime_value": "real",
        }
        order_types = {c.name: c.type for c in orders.columns}
        assert order_types == {
            "order_id": "integer",
            "customer_id": "integer",
            "total": "real",
        }

        # No ``_sheet`` column leaks onto either model (R3).
        for m in models:
            assert "_sheet" not in {c.name for c in m.columns}
            assert "_sheet" not in {c.original_name for c in m.columns}

        # Rows are partitioned and the ``_sheet`` marker is stripped.
        assert customers.row_count == 2
        assert orders.row_count == 2

        # Artifact payloads carry per-model rows, never the README ones.
        save_calls = mock_ctx.artifact_service.save_artifact.call_args_list
        rows_calls = {
            c.kwargs["filename"]: c.kwargs["artifact"]
            for c in save_calls
            if c.kwargs["filename"].startswith("extracted_rows:")
        }
        cust_rows = json.loads(
            rows_calls["extracted_rows:business_customers.json"].inline_data.data.decode("utf-8")
        )
        assert len(cust_rows) == 2
        assert "_sheet" not in cust_rows[0]
        assert cust_rows[0]["customer_id"] == 1
