"""Layer 2A — DataIngester sidecar fetcher.

Pure-Python service. **The agent never parses file content here.** Every
table-bearing format (Excel, CSV today; PDF post-BE-1; DOCX/PPTX post-BE-3)
arrives at the agent as a backend-typed JSONL sidecar; this module fetches
those sidecars, normalises model/column names, and writes the raw rows +
schema as artifacts for downstream consumption.

Scope is intentionally tiny — no MD parsing, no type inference, no
schema-overlap math. ~50 LOC of HTTP + naming + I/O, easy to unit-test
with mocked aiohttp.

Public surface:

* :func:`extract_all` — entry point used by ``CreationWorkflow``/
  ``EditingWorkflow``. Returns ``(proposed_models, failed_artifacts,
  warnings)``.

Internal helpers (kept module-level so unit tests can exercise them in
isolation):

* :func:`fetch_jsonl_sidecar` — aiohttp streaming fetch with retry/backoff;
  enforces ``DATA_INGEST_ROW_CAP`` and emits ``row_cap_hit`` instead of
  silently truncating.
* :func:`snake_case_namer` — collision-suffix snake_case for model/column
  names; transliterates common diacritics, handles Unicode-only inputs.
* :func:`save_extracted_artifacts` — writes ``extracted_rows:{name}.json``
  + ``extracted_schema:{name}.json`` via the ADK artifact service.
"""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from typing import Any, Optional

import aiohttp
import structlog
from google.adk.agents.invocation_context import InvocationContext
from google.genai import types as genai_types

from config import (
    DATA_INGEST_ROW_CAP,
    DOCUMENT_FETCH_BACKOFF_MULTIPLIER,
    DOCUMENT_FETCH_INITIAL_DELAY,
    DOCUMENT_FETCH_MAX_RETRIES,
    DOCUMENT_FETCH_TIMEOUT,
)

from main_agent.net.url_guard import assert_safe_url, UnsafeUrlError
from ..subagents.data_ingester import (
    ProposedColumn,
    ProposedModel,
)

logger = structlog.get_logger(__name__)


# Common diacritics that NFKD won't decompose cleanly. Extending this map is
# preferable to pulling in ``unidecode`` for v1 — keeps the agent runtime
# free of an extra dep, and the most common name-collision cases are Latin
# locales (Turkish, Vietnamese, French, German, Spanish, Polish).
_DIACRITIC_OVERRIDES = {
    "ı": "i",
    "İ": "i",
    "ş": "s",
    "Ş": "s",
    "ğ": "g",
    "Ğ": "g",
    "ç": "c",
    "Ç": "c",
    "ö": "o",
    "Ö": "o",
    "ü": "u",
    "Ü": "u",
    "ñ": "n",
    "Ñ": "n",
    "ß": "ss",
    "ł": "l",
    "Ł": "l",
}


def _ascii_fold(value: str) -> str:
    """Best-effort Unicode → ASCII for snake-casing.

    Step 1: apply manual overrides for codepoints NFKD doesn't decompose.
    Step 2: NFKD normalise and drop combining marks (catches café → cafe).
    Step 3: filter to ASCII; non-Latin scripts (Chinese, Arabic, etc.) end
    up empty here — the caller falls back to ``col_N``.
    """
    for src, dst in _DIACRITIC_OVERRIDES.items():
        value = value.replace(src, dst)
    decomposed = unicodedata.normalize("NFKD", value)
    return decomposed.encode("ascii", "ignore").decode("ascii")


_SNAKE_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SNAKE_LEADING_DIGIT = re.compile(r"^[0-9]")


def snake_case_namer(
    name: str,
    used: set[str],
    *,
    fallback_prefix: str = "col",
) -> str:
    """Convert ``name`` to a unique snake_case identifier safe for D1 columns
    and Python attribute access. Mutates ``used`` to reserve the result.

    Resolution order on collision: append ``_2``, ``_3``, …  The original
    is preserved upstream (``ProposedColumn.original_name``).

    When the input has no ASCII content after folding (e.g. all-Chinese
    headers) we fall back to ``{fallback_prefix}_{N}`` so the downstream
    pipeline still has *some* identifier — the LLM in Layer 2B can then
    rename it semantically.
    """
    folded = _ascii_fold(name or "").lower()
    # Collapse runs of non-alphanumerics into a single underscore.
    collapsed = _SNAKE_NON_ALNUM.sub("_", folded).strip("_")
    if not collapsed:
        # Pure non-Latin or empty — pick an index that isn't already taken.
        idx = 1
        while True:
            candidate = f"{fallback_prefix}_{idx}"
            if candidate not in used:
                used.add(candidate)
                return candidate
            idx += 1
    # SQL identifiers can't start with a digit.
    if _SNAKE_LEADING_DIGIT.match(collapsed):
        collapsed = f"n_{collapsed}"

    candidate = collapsed
    if candidate not in used:
        used.add(candidate)
        return candidate
    # Collision — suffix with _2, _3, …
    idx = 2
    while True:
        candidate = f"{collapsed}_{idx}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        idx += 1


# Backend sidecar column types → D1 type tokens. The backend already typed
# the values; we just thread the canonical D1 token through to downstream
# consumers (BackendModelBuilder, _build_extracted_seed_dataset).
_BACKEND_TYPE_MAP = {
    "integer": "integer",
    "int": "integer",
    "bigint": "integer",
    "number": "real",
    "real": "real",
    "float": "real",
    "double": "real",
    "decimal": "real",
    "text": "text",
    "string": "text",
    "varchar": "text",
    "date": "text",
    "datetime": "text",
    "timestamp": "text",
    "json": "json",
    "object": "json",
    "boolean": "integer",
    "bool": "integer",
}


def _canonical_type(backend_type: Optional[str]) -> str:
    """Map a backend-emitted type token to the canonical D1 token."""
    if not backend_type:
        return "text"
    return _BACKEND_TYPE_MAP.get(str(backend_type).lower(), "text")


async def fetch_jsonl_sidecar(
    url: str,
    row_cap: int = DATA_INGEST_ROW_CAP,
    *,
    timeout_seconds: int = DOCUMENT_FETCH_TIMEOUT,
    max_retries: int = DOCUMENT_FETCH_MAX_RETRIES,
) -> tuple[list[dict], bool]:
    """Fetch a JSONL sidecar from a signed URL.

    Returns ``(rows, row_cap_hit)``:

    * ``rows`` — parsed list of dicts, up to ``row_cap`` entries.
    * ``row_cap_hit`` — ``True`` when the sidecar contained more rows than
      ``row_cap``. Caller is responsible for surfacing a
      ``row_cap_exceeded`` warning to the user — **we never silently
      truncate without flagging it.**

    Retries on 5xx and network errors with exponential backoff, mirroring
    :func:`DocumentArtifactService._fetch_and_save_document`. A terminal
    failure raises ``aiohttp.ClientError`` so the caller can record the
    artifact in ``failed_artifacts``.
    """
    # SSRF guard: `url` originates from user-supplied sidecar metadata. Reject
    # internal/metadata targets up front — a blocked URL is a terminal failure,
    # surfaced to the caller as a ClientError (recorded in failed_artifacts).
    try:
        await assert_safe_url(url)
    except UnsafeUrlError as exc:
        raise aiohttp.ClientError(f"blocked unsafe sidecar URL: {exc}") from exc

    delay = DOCUMENT_FETCH_INITIAL_DELAY
    last_error: Optional[str] = None
    for attempt in range(max_retries + 1):
        try:
            async with aiohttp.ClientSession() as session:
                # allow_redirects=False: a redirect can't bounce the request to an
                # internal target; a 3xx falls through the status!=200 path.
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=timeout_seconds),
                    allow_redirects=False,
                ) as response:
                    if response.status == 200:
                        rows: list[dict] = []
                        row_cap_hit = False
                        # Stream line-by-line so we can stop reading after
                        # row_cap is hit. JSONL is "one JSON object per
                        # line"; blank lines are tolerated.
                        async for raw_line in response.content:
                            line = raw_line.decode("utf-8", errors="replace").strip()
                            if not line:
                                continue
                            try:
                                obj = json.loads(line)
                            except json.JSONDecodeError as e:
                                # A single malformed line shouldn't kill
                                # the whole sidecar — log + skip. If
                                # every line is malformed the caller
                                # ends up with rows=[] which triggers a
                                # downstream "no rows" warning.
                                logger.warning(
                                    "data_ingest.sidecar_jsonl_decode_error",
                                    url=url,
                                    error=str(e),
                                )
                                continue
                            if isinstance(obj, dict):
                                if len(rows) >= row_cap:
                                    row_cap_hit = True
                                    break
                                rows.append(obj)
                        return rows, row_cap_hit

                    if response.status >= 500:
                        last_error = f"HTTP {response.status}"
                    else:
                        # 4xx — no point retrying. Bubble up so the
                        # caller logs failed_artifacts.
                        raise aiohttp.ClientResponseError(
                            response.request_info,
                            response.history,
                            status=response.status,
                            message=f"sidecar fetch returned {response.status}",
                            headers=response.headers,
                        )

        except asyncio.TimeoutError:
            last_error = f"Timeout after {timeout_seconds}s"
        except aiohttp.ClientError:
            # Reraise client errors that aren't retryable so the caller
            # can decide what to do; reraise here for the 4xx path above
            # too.
            raise

        if attempt < max_retries:
            logger.info(
                "data_ingest.sidecar_retry",
                url=url,
                attempt=attempt + 1,
                max_retries=max_retries,
                last_error=last_error,
            )
            await asyncio.sleep(delay)
            delay *= DOCUMENT_FETCH_BACKOFF_MULTIPLIER

    raise aiohttp.ClientError(f"sidecar fetch failed after {max_retries} retries: {last_error}")


def _filename_stem(filename: str) -> str:
    """Strip directory prefix and final extension. ``a/b/sales.xlsx`` → ``sales``."""
    base = filename.rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[0] if "." in base else base


def _sheets_from_sample(sample: Any) -> list[dict]:
    """Normalise the backend's ``structured_data_sample`` to a list of
    sheet dicts: ``[{"sheet_name": str, "columns": list[dict]}, ...]``.

    The backend (``content_service.services.orchestrator._save_structured_data``)
    always wraps tabular output in a ``{"sheets": [...]}`` envelope — even
    for CSV and single-sheet xlsx — so the ``"sheets"`` branch is the hot
    path. The flat-list branches are kept as forgiving fallbacks for
    pre-BE-2 catalog entries and unit-test fixtures.

    Returns an empty list when no usable schema is present; callers then
    fall back to ``_columns_from_rows``.
    """
    if isinstance(sample, dict):
        sheets = sample.get("sheets")
        if isinstance(sheets, list):
            out: list[dict] = []
            for i, s in enumerate(sheets):
                if not isinstance(s, dict):
                    continue
                cols = s.get("columns")
                cols = [c for c in cols if isinstance(c, dict)] if isinstance(cols, list) else []
                name = str(s.get("sheet_name") or f"Sheet{i + 1}")
                out.append({"sheet_name": name, "columns": cols})
            return out
        # Legacy flat shape: pretend it's a single sheet.
        cols = sample.get("columns")
        if isinstance(cols, list):
            return [
                {
                    "sheet_name": "Sheet1",
                    "columns": [c for c in cols if isinstance(c, dict)],
                }
            ]
    if isinstance(sample, list):
        return [
            {
                "sheet_name": "Sheet1",
                "columns": [c for c in sample if isinstance(c, dict)],
            }
        ]
    return []


def _columns_from_sample(sample: Any) -> list[dict]:
    """Back-compat shim: return the *first* sheet's columns from a sample.

    Kept so legacy single-sheet callers and the existing unit tests still
    work; multi-sheet aware callers should use :func:`_sheets_from_sample`.
    """
    sheets = _sheets_from_sample(sample)
    return sheets[0]["columns"] if sheets else []


def _columns_from_rows(rows: list[dict], max_scan: int = 50) -> list[dict]:
    """Fallback: derive column names from the union of keys in the first
    few JSONL rows. Used when the sidecar metadata didn't carry a schema
    block. Types default to ``text`` — the backend already coerced values
    to their canonical Python types, so the seed bridge can re-derive.

    The synthetic ``_sheet`` marker (added by the backend at
    ``orchestrator._save_structured_data``) is filtered out — it is a
    partition key, not a real column.
    """
    if not rows:
        return []
    seen: list[str] = []
    seen_set: set[str] = set()
    for row in rows[:max_scan]:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            if key == "_sheet" or key in seen_set:
                continue
            seen_set.add(key)
            seen.append(key)
    return [{"name": k, "type": "text"} for k in seen]


def _filter_metadata_sheets(
    sheets: list[dict],
    original_filename: str,
) -> tuple[list[dict], str | None]:
    """For multi-sheet uploads, drop 1-column "metadata" sheets (READMEs /
    cover pages). Single-sheet uploads pass through unchanged — a
    1-column single-sheet upload (e.g. an email list) is plausibly the
    user's actual data.

    Returns ``(filtered_sheets, drop_warning)``. ``drop_warning`` is a
    user-facing string when the filter removed every sheet (caller should
    mark the doc as failed), or ``None`` otherwise.
    """
    if len(sheets) <= 1:
        return sheets, None
    filtered = [s for s in sheets if len(s["columns"]) >= 2]
    if not filtered:
        return [], (
            f"{original_filename}: only metadata-style sheets "
            f"(<2 columns) found, nothing to ingest"
        )
    return filtered, None


def _build_sheet_groups(
    sheets: list[dict],
    rows: list[dict],
    base_stem: str,
) -> list[dict]:
    """Turn the normalised sheet list + fetched rows into builder-ready
    groups. Each group is ``{"columns", "rows", "model_basename"}``.

    Multi-sheet path partitions ``rows`` by ``_sheet`` and stems each
    model name with the sheet name; single-sheet path keeps the original
    behaviour (one model named after the filename stem).

    In both paths the synthetic ``_sheet`` marker is stripped from rows
    — the backend tags every row with it even on single-sheet uploads,
    and downstream consumers (seed builder, D1 schema generator) treat
    every row key as a candidate column.
    """
    if len(sheets) > 1:
        partitioned = _partition_rows_by_sheet(rows, [s["sheet_name"] for s in sheets])
        return [
            {
                "columns": s["columns"],
                "rows": partitioned.get(s["sheet_name"], []),
                "model_basename": f"{base_stem}_{s['sheet_name']}",
            }
            for s in sheets
        ]
    # Single-sheet (or empty sample): one model, all rows. Strip the
    # ``_sheet`` marker too — the multi-sheet path strips it inside
    # ``_partition_rows_by_sheet``; mirror that here.
    single_columns = sheets[0]["columns"] if sheets else []
    stripped = [{k: v for k, v in r.items() if k != "_sheet"} for r in rows if isinstance(r, dict)]
    return [
        {
            "columns": single_columns,
            "rows": stripped,
            "model_basename": base_stem,
        }
    ]


def _build_model_for_sheet_group(
    sg: dict,
    artifact_name: str,
    original_filename: str,
    used_model_names: set[str],
    row_cap_hit: bool,
) -> tuple[ProposedModel | None, list[dict], list[str], str | None]:
    """Build a single ``ProposedModel`` from one sheet group.

    Returns ``(model, canonical_rows, warnings, model_name)``:
    * ``model`` — ``None`` when the group is empty or columns can't be
      derived (caller skips it).
    * ``warnings`` — per-group warnings to surface to the user.
    * ``model_name`` — the assigned canonical name (or ``None`` if no
      model was built).
    """
    warns: list[str] = []
    sg_rows = sg["rows"]
    if not sg_rows:
        warns.append(
            f"{original_filename} [{sg['model_basename']}]: " f"no rows attributed to this sheet"
        )
        return None, [], warns, None

    raw_columns = sg["columns"] or _columns_from_rows(sg_rows)
    used_column_names: set[str] = set()
    columns = _build_proposed_columns(raw_columns, sg_rows, used_column_names)
    if not columns:
        warns.append(
            f"{original_filename} [{sg['model_basename']}]: "
            f"no columns could be derived from sidecar"
        )
        return None, [], warns, None

    model_name = snake_case_namer(
        sg["model_basename"],
        used_model_names,
        fallback_prefix="model",
    )
    canonical_rows = _rows_normalised_to_canonical_columns(sg_rows, columns)
    model = ProposedModel(
        name=model_name,
        source_artifact=artifact_name,
        columns=columns,
        row_count=len(canonical_rows),
        row_cap_hit=row_cap_hit,
        # Default target_mode — Layer 2B may flip it to append /
        # replace in edit mode.
        target_mode="create",
        target_existing_model_name=None,
        notes="",
    )
    return model, canonical_rows, warns, model_name


def _partition_rows_by_sheet(
    rows: list[dict],
    sheet_names: list[str],
) -> dict[str, list[dict]]:
    """Group ``rows`` by their ``_sheet`` marker and strip the marker.

    Rows without a recognised ``_sheet`` value are dropped — this only
    happens for legacy payloads where the backend forgot to tag them, and
    we'd rather emit a model with the rows we can confidently attribute
    than silently mash them into the first sheet.
    """
    known = set(sheet_names)
    out: dict[str, list[dict]] = {n: [] for n in sheet_names}
    for row in rows:
        if not isinstance(row, dict):
            continue
        sn = row.get("_sheet")
        if sn not in known:
            continue
        out[sn].append({k: v for k, v in row.items() if k != "_sheet"})
    return out


def _build_proposed_columns(
    raw_columns: list[dict],
    rows: list[dict],
    used_column_names: set[str],
) -> list[ProposedColumn]:
    """Turn backend-typed schema dicts into ``ProposedColumn`` records."""
    out: list[ProposedColumn] = []
    for col in raw_columns:
        original = str(col.get("name", "")).strip()
        if not original:
            continue
        canonical = snake_case_namer(original, used_column_names)
        col_type = _canonical_type(col.get("type"))
        nullable = bool(col.get("nullable", True))
        samples: list[str] = []
        for row in rows[:5]:
            if isinstance(row, dict) and original in row:
                value = row[original]
                if value is None:
                    continue
                samples.append(str(value)[:80])
                if len(samples) >= 3:
                    break
        out.append(
            ProposedColumn(
                name=canonical,
                original_name=original,
                type=col_type,
                nullable=nullable,
                sample_values=samples,
            )
        )
    return out


def _rows_normalised_to_canonical_columns(
    rows: list[dict],
    columns: list[ProposedColumn],
) -> list[dict]:
    """Re-key each row from ``original_name`` → canonical snake_case name.

    Downstream consumers (``_build_extracted_seed_dataset``) expect each
    row's keys to match the column names declared on the model plan, so we
    rewrite once here rather than threading both names through every
    layer.
    """
    rename = {c.original_name: c.name for c in columns}
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append({rename.get(k, k): v for k, v in row.items()})
    return out


async def save_extracted_artifacts(
    ctx: InvocationContext,
    models: list[ProposedModel],
    rows_by_model: dict[str, list[dict]],
) -> None:
    """Persist raw extracted rows + schema as ADK artifacts.

    Two artifacts per model:

    * ``extracted_rows:{name}.json`` — list[dict], keys = canonical column
      names
    * ``extracted_schema:{name}.json`` — ``{name, columns}`` shaped like
      the eventual ``ModelPlan`` dict so ``_build_extracted_seed_dataset``
      can ingest it directly.

    Idempotent — overwrites existing artifacts (deploys are turn-scoped).
    """
    for model in models:
        rows = rows_by_model.get(model.name, [])
        rows_bytes = json.dumps(rows, ensure_ascii=False).encode("utf-8")
        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=f"extracted_rows:{model.name}.json",
            artifact=genai_types.Part.from_bytes(data=rows_bytes, mime_type="application/json"),
        )

        # `_build_extracted_seed_dataset` (backend_builder.py:36) reads
        # ``col["required"]`` to decide whether to inject a typed default
        # for null values. Layer 2A's internal model uses ``nullable``;
        # invert it here so the bridge sees the field it expects.
        # ``nullable`` is kept on the artifact for human-debuggable
        # provenance but the seed builder ignores it.
        schema_dict = {
            "name": model.name,
            "columns": [
                {
                    "name": col.name,
                    "type": col.type,
                    "required": not col.nullable,
                    "nullable": col.nullable,
                    "original_name": col.original_name,
                }
                for col in model.columns
            ],
        }
        schema_bytes = json.dumps(schema_dict, ensure_ascii=False).encode("utf-8")
        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=f"extracted_schema:{model.name}.json",
            artifact=genai_types.Part.from_bytes(data=schema_bytes, mime_type="application/json"),
        )


async def extract_all(
    ctx: InvocationContext,
    content_context,  # ContentContext — typed via TYPE_CHECKING to avoid
    # importing the heavy DocumentArtifactService module here.
) -> tuple[list[ProposedModel], list[str], list[str]]:
    """Layer 2A entry point.

    For every document in ``content_context.structured_documents`` that
    has a usable sidecar URL, fetches the JSONL, builds a mechanically-
    named :class:`ProposedModel`, and writes raw artifacts.

    Returns ``(proposed_models, failed_artifacts, warnings)``:

    * ``proposed_models`` — what Layer 2B receives as input.
    * ``failed_artifacts`` — artifact names where the sidecar was
      missing or unreachable. Surfaced to the user.
    * ``warnings`` — non-fatal issues (row cap exceeded, etc.). Also
      surfaced.

    No LLM call here. No exceptions on per-doc failures — each is
    recorded and the next doc proceeds.
    """
    proposed: list[ProposedModel] = []
    failed: list[str] = []
    warnings: list[str] = []
    used_model_names: set[str] = set()
    rows_by_model: dict[str, list[dict]] = {}

    for artifact_name, meta in content_context.structured_documents.items():
        if not meta.get("has_structured_data"):
            continue

        url = meta.get("structured_data_url")
        if not url:
            # Pre-BE-2 catalog entry or backend-side outage — there's a
            # sample but no full sidecar URL. We could try to use the
            # sample directly, but doing so risks importing a 10-row
            # placeholder as if it were the real data. Better to fail
            # loudly so the user knows their import wasn't complete.
            failed.append(artifact_name)
            logger.info(
                "data_ingest.sidecar_url_missing",
                artifact=artifact_name,
                original_filename=meta.get("original_filename"),
            )
            continue

        try:
            # Read DATA_INGEST_ROW_CAP at call time (not via the function's
            # default arg) so tests can patch the module-level constant
            # without re-importing the function.
            rows, row_cap_hit = await fetch_jsonl_sidecar(url, row_cap=DATA_INGEST_ROW_CAP)
        except Exception as exc:  # noqa: BLE001 — bound errors logged + recorded
            logger.warning(
                "data_ingest.sidecar_fetch_failed",
                artifact=artifact_name,
                url=url,
                error=str(exc),
            )
            failed.append(artifact_name)
            continue

        if not rows:
            warnings.append(
                f"{meta.get('original_filename', artifact_name)}: sidecar contained no rows"
            )
            failed.append(artifact_name)
            continue

        original_filename = meta.get("original_filename") or artifact_name
        base_stem = _filename_stem(original_filename)

        sheets, drop_warning = _filter_metadata_sheets(
            _sheets_from_sample(meta.get("structured_data_sample")),
            original_filename,
        )
        if drop_warning:
            warnings.append(drop_warning)
            failed.append(artifact_name)
            continue

        if row_cap_hit:
            # Coarse: the upload-level cap was hit, so flag every model
            # we derive from it. Per-sheet accounting requires the
            # backend to expose per-sheet totals at fetch time.
            warnings.append(
                f"{original_filename}: row count exceeds {DATA_INGEST_ROW_CAP}; "
                f"first {DATA_INGEST_ROW_CAP} rows imported, remainder skipped"
            )

        for sg in _build_sheet_groups(sheets, rows, base_stem):
            model, canonical_rows, sg_warnings, model_name = _build_model_for_sheet_group(
                sg,
                artifact_name=artifact_name,
                original_filename=original_filename,
                used_model_names=used_model_names,
                row_cap_hit=row_cap_hit,
            )
            warnings.extend(sg_warnings)
            if model is None:
                continue
            # ``model`` and ``model_name`` always co-vary in the helper.
            rows_by_model[model_name] = canonical_rows  # type: ignore[index]
            proposed.append(model)

    if proposed:
        await save_extracted_artifacts(ctx, proposed, rows_by_model)

    logger.info(
        "data_ingest.extract_all_done",
        proposed_count=len(proposed),
        failed_count=len(failed),
        warning_count=len(warnings),
    )
    return proposed, failed, warnings
