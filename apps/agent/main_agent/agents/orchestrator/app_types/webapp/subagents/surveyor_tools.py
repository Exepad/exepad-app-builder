"""ADK FunctionTool wrappers for the Surveyor agent.

Class A (always on) static-analysis + cross-turn tools:

* :func:`infer_handler_return_shape_tool` — return-shape inference on one handler.
* :func:`infer_consumer_field_reads_tool` — field-read detection on one component.
* :func:`field_mismatch_report_tool` — cross-cuts producers vs consumers.
* :func:`prior_turn_diff_tool` — what the prior turn changed + user complaint now.
* :func:`prior_turn_diagnosis_tool` — load prior turn's ``diagnostic_report:N.json``.
* :func:`code_revision_diff_tool` — diff GCS-versioned ``{name}_{hash}_v{N}`` blobs
  for regression-shaped symptoms (ground truth for what literally shipped).

Class B (gated on ``SURVEYOR_RUNTIME_PROBES_ENABLED``) live-deployment probes:

* :func:`execute_handler_tool` — proxy a handler call to the preview WfP worker.
* :func:`query_db_tool` — read-only SQL on preview D1 (SELECT/PRAGMA whitelisted).
* :func:`sample_table_tool` — convenience wrapper for ``SELECT * FROM X LIMIT N``.
* :func:`screenshot_preview_tool` — Cloudflare Browser Rendering, GCS-signed URL.
* :func:`read_browser_state_tool` — DOM text/styles/attributes + page errors.

All tools are async, return JSON-serialisable dicts, and gracefully degrade
on missing data (returning an ``error`` field rather than raising).
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any

from google.adk.tools import FunctionTool, ToolContext

from main_agent.constants import StateKeys
from main_agent.services.validation.tsx_ast.shape_inference import (
    field_mismatch_report_global,
    infer_consumer_field_reads,
    infer_handler_return_shape,
)

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.artifact_tools import (
    HANDLER_ARTIFACT_PREFIX,
)

from .artifact_tools import ARTIFACT_PREFIXES

_HANDLER_PREFIX = HANDLER_ARTIFACT_PREFIX
_COMPONENT_PREFIX = ARTIFACT_PREFIXES["component"]


# ---------------------------------------------------------------------------
# Internal artifact helpers (mirrors artifact_tools._gather_artifact_sources
# but scoped to what Surveyor needs)
# ---------------------------------------------------------------------------


async def _load_artifact_source(tool_context: ToolContext, filename: str) -> str | None:
    """Return the UTF-8 source of one artifact, or ``None`` if unavailable."""
    try:
        artifact = await tool_context.load_artifact(filename=filename)
    except Exception:
        return None
    if artifact is None or getattr(artifact, "inline_data", None) is None:
        return None
    try:
        return artifact.inline_data.data.decode("utf-8", errors="replace")
    except Exception:
        return None


async def _list_artifacts_with_prefix(tool_context: ToolContext, prefix: str) -> list[str]:
    """Return every artifact name starting with ``prefix``."""
    try:
        names = await tool_context.list_artifacts()
    except Exception:
        return []
    return [n for n in (names or []) if isinstance(n, str) and n.startswith(prefix)]


def _strip_handler_artifact_name(filename: str) -> str:
    """``handler_code:foo.tsx`` -> ``foo``."""
    return filename.removeprefix(_HANDLER_PREFIX).removesuffix(".tsx")


def _strip_component_artifact_name(filename: str) -> str:
    """``codefocus_component:Foo.tsx`` -> ``Foo``."""
    return filename.removeprefix(_COMPONENT_PREFIX).removesuffix(".tsx")


async def _gather_handler_shapes(tool_context: ToolContext) -> dict[str, dict[str, str]]:
    """Return ``{handler_name: {field: type_hint}}`` for every staged handler artifact."""
    out: dict[str, dict[str, str]] = {}
    names = await _list_artifacts_with_prefix(tool_context, _HANDLER_PREFIX)
    for filename in names:
        source = await _load_artifact_source(tool_context, filename)
        if source is None:
            continue
        shape = infer_handler_return_shape(source)
        if shape:
            out[_strip_handler_artifact_name(filename)] = shape
    return out


async def _gather_model_shapes_from_state(tool_context: ToolContext) -> dict[str, dict[str, str]]:
    """Return ``{model_name: {column: 'unknown'}}`` from app config in state.

    Models declare columns in ``app_config.backend.models[*].columns``. The
    Surveyor's mismatch report can then flag consumer reads against
    nonexistent columns the same way it flags missing handler return
    fields. Type hints are ``"unknown"`` because column types in the
    config (``"text"``, ``"integer"``, etc.) don't map cleanly to JS-side
    type strings.
    """
    out: dict[str, dict[str, str]] = {}
    raw_config = tool_context.state.get(StateKeys.APP_CONFIG)
    if not raw_config:
        return out
    try:
        cfg = json.loads(raw_config) if isinstance(raw_config, str) else raw_config
    except Exception:
        return out
    if not isinstance(cfg, dict):
        return out
    backend = cfg.get("backend") or {}
    models = backend.get("models") or []
    for m in models:
        if not isinstance(m, dict):
            continue
        name = m.get("name")
        cols = m.get("columns") or []
        if not name or not isinstance(cols, list):
            continue
        cols_dict: dict[str, str] = {}
        # `id` and `owner_id` are platform-managed columns that exist on every
        # model — declare them so consumers reading them don't get false flags.
        cols_dict["id"] = "unknown"
        cols_dict["owner_id"] = "unknown"
        cols_dict["created_at"] = "unknown"
        cols_dict["updated_at"] = "unknown"
        for col in cols:
            if isinstance(col, dict):
                col_name = col.get("name")
                if col_name:
                    cols_dict[col_name] = "unknown"
        if cols_dict:
            out[name] = cols_dict
    return out


# ---------------------------------------------------------------------------
# Tool: infer_handler_return_shape_tool
# ---------------------------------------------------------------------------


async def infer_handler_return_shape_tool_impl(
    tool_context: ToolContext,
    handler_name: str,
) -> dict[str, Any]:
    """Return the ``{field: type_hint}`` shape for one handler's TSX.

    ``handler_name`` is the bare handler name (e.g. ``"getOccupancyTrend"``);
    the tool maps to the ``handler_code:{handler_name}.tsx`` artifact.
    Type hints: ``"string"``, ``"number"``, ``"boolean"``, ``"null"``,
    ``"array"``, ``"object"``, ``"mixed"``, or ``"unknown"``.

    Returns ``{handler, shape, source_file}`` on success;
    ``{handler, error}`` if the artifact is missing.
    """
    if not handler_name or not handler_name.strip():
        return {"error": "handler_name must be non-empty"}
    artifact_name = f"{_HANDLER_PREFIX}{handler_name}.tsx"
    source = await _load_artifact_source(tool_context, artifact_name)
    if source is None:
        return {
            "handler": handler_name,
            "error": f"handler artifact '{artifact_name}' not found",
        }
    shape = infer_handler_return_shape(source)
    return {
        "handler": handler_name,
        "shape": shape,
        "source_file": artifact_name,
    }


infer_handler_return_shape_tool = FunctionTool(infer_handler_return_shape_tool_impl)


# ---------------------------------------------------------------------------
# Tool: infer_consumer_field_reads_tool
# ---------------------------------------------------------------------------


async def infer_consumer_field_reads_tool_impl(
    tool_context: ToolContext,
    component_name: str,
) -> dict[str, Any]:
    """Return every ``useHandler`` / ``useModel`` consumer site for one component.

    ``component_name`` is the bare component name (e.g. ``"DashboardContent"``);
    maps to ``codefocus_component:{component_name}.tsx``.

    Returns ``{component, sites: [...], source_file}`` where each site is
    ``{producer, producer_kind, fields_read, sites}``. Empty ``sites`` means
    the component reads no fields from any producer (or has no useHandler /
    useModel calls).
    """
    if not component_name or not component_name.strip():
        return {"error": "component_name must be non-empty"}
    artifact_name = f"{_COMPONENT_PREFIX}{component_name}.tsx"
    source = await _load_artifact_source(tool_context, artifact_name)
    if source is None:
        return {
            "component": component_name,
            "error": f"component artifact '{artifact_name}' not found",
        }
    sites = infer_consumer_field_reads(source)
    return {
        "component": component_name,
        "sites": [
            {
                "producer": s.producer,
                "producer_kind": s.producer_kind,
                "fields_read": list(s.fields_read),
                "sites": [list(p) for p in s.sites],
            }
            for s in sites
        ],
        "source_file": artifact_name,
    }


infer_consumer_field_reads_tool = FunctionTool(infer_consumer_field_reads_tool_impl)


# ---------------------------------------------------------------------------
# Tool: field_mismatch_report_tool
# ---------------------------------------------------------------------------


async def field_mismatch_report_tool_impl(
    tool_context: ToolContext,
    components: list[str] | None = None,
) -> dict[str, Any]:
    """Cross-reference every consumer's field reads against producers' shapes.

    ``components``: optional whitelist of component names (bare, no prefix)
    to scope the report. When ``None`` or empty, scans every staged
    ``codefocus_component:*`` artifact.

    Returns:
    ``{
        producers: {handler_name: {field: type}},
        models: {model_name: {column: "unknown"}},
        components_scanned: [...],
        mismatches: [{producer, consumer, field, kind, sites, detail}, ...],
    }``

    The ``mismatches`` list is the actionable signal — empty means every
    consumer's reads are covered by a declared producer field.
    """
    handler_shapes = await _gather_handler_shapes(tool_context)
    model_shapes = await _gather_model_shapes_from_state(tool_context)
    all_shapes: dict[str, dict[str, str]] = {**handler_shapes, **model_shapes}

    component_names_to_scan: list[str]
    if components:
        component_names_to_scan = [c for c in components if c]
    else:
        all_components = await _list_artifacts_with_prefix(tool_context, _COMPONENT_PREFIX)
        component_names_to_scan = [_strip_component_artifact_name(n) for n in all_components]

    # Aggregate every component's consumer sites first so dead_in_consumer
    # can be checked globally — flagging fields no consumer in the app reads,
    # not just fields one specific component skipped.
    sites_by_component: dict[str, list] = {}
    components_loaded: list[str] = []
    components_skipped: list[str] = []
    for comp_name in component_names_to_scan:
        artifact_name = f"{_COMPONENT_PREFIX}{comp_name}.tsx"
        source = await _load_artifact_source(tool_context, artifact_name)
        if source is None:
            components_skipped.append(comp_name)
            continue
        components_loaded.append(comp_name)
        sites = infer_consumer_field_reads(source)
        if sites:
            sites_by_component[f"{comp_name}.tsx"] = sites

    mismatches = field_mismatch_report_global(all_shapes, sites_by_component)

    all_mismatches: list[dict[str, Any]] = [
        {
            "producer": m.producer,
            "consumer": m.consumer,
            "field": m.field,
            "kind": m.kind,
            "sites": [list(p) for p in m.sites],
            "detail": m.detail,
        }
        for m in mismatches
    ]

    return {
        "producers": handler_shapes,
        "models": model_shapes,
        "components_scanned": components_loaded,
        "components_skipped": components_skipped,
        "mismatches": all_mismatches,
        "mismatch_count": len(all_mismatches),
    }


field_mismatch_report_tool = FunctionTool(field_mismatch_report_tool_impl)


# ---------------------------------------------------------------------------
# Tool: prior_turn_diff_tool
# ---------------------------------------------------------------------------


async def prior_turn_diff_tool_impl(
    tool_context: ToolContext,
) -> dict[str, Any]:
    """Surface what the prior edit turn changed + the current user complaint.

    Reads:
    * ``StateKeys.EDIT_PLAN`` (prior turn's EditorOutput dict) — the actions
      most-recently planned.
    * ``StateKeys.CHAT_HISTORY`` — last ~5 user/assistant exchanges.
    * ``StateKeys.CURRENT_PROMPT`` — what the user is asking for THIS turn.

    Returns:
    ``{
        prior_actions_summary: [...]           # bullet list per action class
        prior_action_counts: {class: count}    # quick totals
        current_user_request: str              # this-turn user message
        chat_history: [...]                    # recent context (raw)
        has_prior_turn: bool                   # false on first edit turn
    }``

    The Surveyor uses this to spot the "prior fix didn't land — user is back"
    pattern: if the prior turn renamed a handler output and the user is now
    reporting the same UI symptom, the consumer cascade likely wasn't applied.
    """
    state = tool_context.state
    prior_plan_raw = state.get(StateKeys.EDIT_PLAN)
    chat_history_raw = state.get(StateKeys.CHAT_HISTORY) or []
    current_prompt = state.get(StateKeys.CURRENT_PROMPT) or ""

    # Coerce edit_plan to dict (it may be a Pydantic model or already a dict).
    prior_plan: dict[str, Any] | None = None
    if isinstance(prior_plan_raw, dict):
        prior_plan = prior_plan_raw
    elif prior_plan_raw is not None:
        try:
            prior_plan = (
                prior_plan_raw.model_dump()
                if hasattr(prior_plan_raw, "model_dump")
                else dict(prior_plan_raw)
            )
        except Exception:
            prior_plan = None

    if not prior_plan:
        return {
            "has_prior_turn": False,
            "prior_actions_summary": [],
            "prior_action_counts": {},
            "current_user_request": current_prompt,
            "chat_history": (
                list(chat_history_raw)[:5] if isinstance(chat_history_raw, list) else []
            ),
        }

    action_classes = (
        "modify_styles_actions",
        "change_backend_models_actions",
        "modify_logic_actions",
        "add_handler_actions",
        "modify_handler_actions",
        "remove_handler_actions",
        "rename_page_title_actions",
        "frontend_build_actions",
        "ingest_data_actions",
        "edit_seed_data_actions",
    )
    counts: dict[str, int] = {}
    summary: list[str] = []
    for cls in action_classes:
        actions = prior_plan.get(cls) or []
        if not isinstance(actions, list):
            continue
        if actions:
            counts[cls] = len(actions)
        for a in actions:
            if not isinstance(a, dict):
                continue
            # Tailored one-line summary per class.
            if cls == "modify_handler_actions":
                summary.append(
                    f"modify_handler({a.get('handler_name', '?')}): "
                    f"{(a.get('modification_plan') or '')[:120]}"
                )
            elif cls == "add_handler_actions":
                summary.append(
                    f"add_handler({a.get('handler_name', '?')}, " f"outputs={a.get('outputs', [])})"
                )
            elif cls == "remove_handler_actions":
                summary.append(f"remove_handler({a.get('handler_name', '?')})")
            elif cls == "frontend_build_actions":
                prompt = (a.get("prompt") or "")[:160]
                summary.append(f"frontend_build: {prompt}")
            elif cls == "change_backend_models_actions":
                summary.append(f"change_backend_models: {(a.get('editor_prompt') or '')[:120]}")
            elif cls == "modify_logic_actions":
                summary.append(f"modify_logic: {(a.get('editor_prompt') or '')[:120]}")
            elif cls == "modify_styles_actions":
                summary.append(f"modify_styles: {(a.get('editor_prompt') or '')[:120]}")
            elif cls == "rename_page_title_actions":
                summary.append(
                    f"rename_page_title({a.get('page_uuid', '?')[:8]}): {a.get('new_title', '?')}"
                )
            elif cls == "ingest_data_actions":
                summary.append(
                    f"ingest_data({a.get('target_model_name', '?')}, " f"mode={a.get('mode', '?')})"
                )
            elif cls == "edit_seed_data_actions":
                summary.append(
                    f"edit_seed_data({a.get('target_model_name', '?')}): "
                    f"{(a.get('editor_prompt') or '')[:120]}"
                )

    return {
        "has_prior_turn": True,
        "prior_actions_summary": summary,
        "prior_action_counts": counts,
        "current_user_request": current_prompt,
        "chat_history": list(chat_history_raw)[:5] if isinstance(chat_history_raw, list) else [],
    }


prior_turn_diff_tool = FunctionTool(prior_turn_diff_tool_impl)


# ---------------------------------------------------------------------------
# Tool: prior_turn_diagnosis_tool
# ---------------------------------------------------------------------------


async def prior_turn_diagnosis_tool_impl(
    tool_context: ToolContext,
) -> dict[str, Any]:
    """Load the prior turn's ``DiagnosticReport`` artifact, if present.

    Looks for ``diagnostic_report:N.json`` artifacts and returns the highest-N
    one (the most recent). Returns ``{has_prior_diagnosis: false}`` on the
    first edit turn or when no diagnosis artifact exists.

    The Surveyor uses this to detect "we already diagnosed this last turn"
    patterns — if a prior root_cause finding wasn't acted on, the current
    diagnosis can pin its confidence high without re-running expensive tools.
    """
    try:
        names = await tool_context.list_artifacts()
    except Exception:
        names = []
    candidates: list[tuple[int, str]] = []
    for name in names or []:
        if not isinstance(name, str) or not name.startswith("diagnostic_report:"):
            continue
        # Format: diagnostic_report:<turn>.json
        try:
            stem = name.removeprefix("diagnostic_report:").removesuffix(".json")
            turn = int(stem)
            candidates.append((turn, name))
        except Exception:
            continue
    if not candidates:
        return {"has_prior_diagnosis": False}

    # Highest turn = most recent.
    candidates.sort(reverse=True)
    _, latest_name = candidates[0]
    source = await _load_artifact_source(tool_context, latest_name)
    if source is None:
        return {"has_prior_diagnosis": False, "error": f"could not load {latest_name}"}
    try:
        parsed = json.loads(source)
    except Exception as e:
        return {"has_prior_diagnosis": False, "error": f"could not parse {latest_name}: {e}"}
    return {
        "has_prior_diagnosis": True,
        "artifact": latest_name,
        "report": parsed,
    }


prior_turn_diagnosis_tool = FunctionTool(prior_turn_diagnosis_tool_impl)


# ---------------------------------------------------------------------------
# Tool: code_revision_diff_tool (Class A — always on)
# ---------------------------------------------------------------------------


_CODE_REVISION_KINDS = frozenset({"handler", "component", "seed"})


async def code_revision_diff_tool_impl(
    tool_context: ToolContext,
    kind: str,
    name: str,
    max_revisions_back: int = 1,
) -> dict[str, Any]:
    """Diff a code file's current revision against a prior revision.

    Cross-revision history lived in the cloud object store, where each upload
    accumulated a versioned ``{name}_{hash}_v{N}.{ext}`` blob. Self-host has no
    durable revision store — the agent receives only the current sources inline
    each edit turn — so this probe reports no prior revisions. The Surveyor
    treats ``has_revisions: False`` as "nothing to diff" and proceeds.

    Args:
        kind: ``handler`` | ``component`` | ``seed``.
        name: File stem (handler name, component name, seed dataset name).
        max_revisions_back: Accepted for signature compatibility; unused.
    """
    if kind not in _CODE_REVISION_KINDS:
        return {
            "has_revisions": False,
            "error": f"unknown_kind: {kind} (expected handler|component|seed)",
        }
    return {
        "has_revisions": False,
        "name": name,
        "file_kind": kind,
        "note": "revision_history_unavailable_selfhost",
    }


code_revision_diff_tool = FunctionTool(code_revision_diff_tool_impl)


# ---------------------------------------------------------------------------
# Class B tools — runtime probes (gated on SURVEYOR_RUNTIME_PROBES_ENABLED)
# ---------------------------------------------------------------------------


# Session-state key for per-turn runtime probe telemetry. Read by
# ``timing_tracker.format_summary`` to emit the RUNTIME PROBES SUMMARY
# block. Each entry: {tool, duration_ms, error?, byte_size?}.
_RUNTIME_PROBE_LOG_KEY = "runtime_probe_log"


def _record_probe(
    tool_context: ToolContext,
    tool_name: str,
    result: dict[str, Any],
) -> None:
    """Append one telemetry record for the just-completed Class B probe.

    Reads ``duration_ms`` and ``error`` straight from the result dict
    (every probe contract surfaces these). Never raises — telemetry
    failures must not abort the tool call.
    """
    try:
        log = tool_context.state.get(_RUNTIME_PROBE_LOG_KEY)
        if not isinstance(log, list):
            log = []
        entry: dict[str, Any] = {
            "tool": tool_name,
            "duration_ms": result.get("duration_ms"),
        }
        if result.get("error"):
            entry["error"] = result["error"]
        if result.get("byte_size"):
            entry["byte_size"] = result["byte_size"]
        log.append(entry)
        tool_context.state[_RUNTIME_PROBE_LOG_KEY] = log
    except Exception:
        # Telemetry must never break the workflow.
        pass


def _get_app_id(tool_context: ToolContext) -> str | None:
    """Read the app_uuid for the current invocation from session state."""
    return tool_context.state.get(StateKeys.APP_UUID)


async def execute_handler_tool_impl(
    tool_context: ToolContext,
    handler_name: str,
    params: dict[str, Any] | None = None,
    as_user: str | None = None,
) -> dict[str, Any]:
    """Probe a single handler on the live preview deployment.

    Proxies to ``POST /api/{appId}/_diag/execute_handler`` on the runtime
    worker, which dispatches to the preview WfP worker via the same path
    a real ``/rpc`` request would take. Returns the handler's response or
    a structured ``error`` dict; never raises.

    ``as_user`` is the X-User-Id sent to the app-backend. Handlers
    typically scope reads/writes by ``owner_id`` — pass a real owner_id
    when probing user-scoped data, otherwise the handler will return
    rows owned by the diagnostic principal (typically empty).
    """
    from main_agent.services.runtime_probe_client import RuntimeProbeClient

    app_id = _get_app_id(tool_context)
    if not app_id:
        return {"error": "no_app_uuid_in_state"}
    client = RuntimeProbeClient()
    result = await client.execute_handler(
        app_id, handler_name=handler_name, params=params, as_user=as_user
    )
    _record_probe(tool_context, "execute_handler_tool", result)
    return result


execute_handler_tool = FunctionTool(execute_handler_tool_impl)


async def query_db_tool_impl(
    tool_context: ToolContext,
    sql: str,
) -> dict[str, Any]:
    """Read-only SQL probe on the preview D1.

    Worker enforces a SELECT/PRAGMA whitelist (``node-sql-parser`` AST +
    prefix gate); anything else returns an ``error`` dict. Hard cap of
    100 rows.
    """
    from main_agent.services.runtime_probe_client import RuntimeProbeClient

    app_id = _get_app_id(tool_context)
    if not app_id:
        return {"error": "no_app_uuid_in_state"}
    client = RuntimeProbeClient()
    result = await client.query_db(app_id, sql=sql)
    _record_probe(tool_context, "query_db_tool", result)
    return result


query_db_tool = FunctionTool(query_db_tool_impl)


async def sample_table_tool_impl(
    tool_context: ToolContext,
    name: str,
    limit: int = 10,
) -> dict[str, Any]:
    """Show the first N rows of a D1 table — convenience wrapper around query_db."""
    from main_agent.services.runtime_probe_client import RuntimeProbeClient

    app_id = _get_app_id(tool_context)
    if not app_id:
        return {"error": "no_app_uuid_in_state"}
    client = RuntimeProbeClient()
    result = await client.sample_table(app_id, name=name, limit=limit)
    _record_probe(tool_context, "sample_table_tool", result)
    return result


sample_table_tool = FunctionTool(sample_table_tool_impl)


async def _capture_browser_state(
    app_id: str,
    *,
    path: str,
    selector: str | None,
    viewport: dict | None,
    want_screenshot: bool,
    wait_for_selector: str | None,
) -> dict[str, Any]:
    """Shared inspect-endpoint call used by the screenshot + read-state tools.

    Always issues the probe — caller is responsible for app_id resolution.
    Splitting this concern keeps telemetry honest: short-circuits before
    the call shouldn't record a probe, but probe-level errors should.
    """
    from main_agent.services.runtime_probe_client import RuntimeProbeClient

    client = RuntimeProbeClient()
    return await client.inspect(
        app_id,
        path=path,
        selector=selector,
        viewport=viewport,
        want_screenshot=want_screenshot,
        wait_for_selector=wait_for_selector,
    )


async def screenshot_preview_tool_impl(
    tool_context: ToolContext,
    path: str = "/",
    viewport: dict[str, int] | None = None,
    wait_for_selector: str | None = None,
) -> dict[str, Any]:
    """Capture a PNG screenshot of the preview app and return metadata only.

    Bytes never enter the LLM context. Self-host has no object store to host
    the PNG in (the GCS upload + signed-URL path was removed with the rest of
    the GCS coupling), and the underlying browser probe is itself unavailable
    in self-host (``/_diag/inspect`` returns 503), so this tool reports the
    capture metadata without a retrievable image URL.
    """
    app_id = _get_app_id(tool_context)
    if not app_id:
        return {"error": "no_app_uuid_in_state"}

    result = await _capture_browser_state(
        app_id,
        path=path,
        selector=None,
        viewport=viewport or {"width": 1280, "height": 720},
        want_screenshot=True,
        wait_for_selector=wait_for_selector,
    )
    if result.get("error"):
        _record_probe(tool_context, "screenshot_preview_tool", result)
        return result

    png_b64 = result.get("png_b64")
    if not png_b64:
        err = {"error": "no_screenshot_returned", "duration_ms": result.get("duration_ms")}
        _record_probe(tool_context, "screenshot_preview_tool", err)
        return err
    try:
        png_bytes = base64.b64decode(png_b64)
    except Exception as e:
        err = {"error": f"png_decode_failed: {e}", "duration_ms": result.get("duration_ms")}
        _record_probe(tool_context, "screenshot_preview_tool", err)
        return err

    # No object store to host the PNG in (the GCS upload + signed-URL path was
    # removed with the rest of the GCS coupling), and bytes must never enter the
    # LLM context — so return capture metadata without a retrievable URL.
    final = {
        "error": "screenshot_storage_unavailable",
        "detail": "no object store to host screenshots in self-host",
        "byte_size": len(png_bytes),
        "captured_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "page_errors": result.get("page_errors", []),
        "failed_requests": result.get("failed_requests", []),
        "duration_ms": result.get("duration_ms"),
    }
    _record_probe(tool_context, "screenshot_preview_tool", final)
    return final


screenshot_preview_tool = FunctionTool(screenshot_preview_tool_impl)


async def read_browser_state_tool_impl(
    tool_context: ToolContext,
    path: str = "/",
    selector: str = "body",
    viewport: dict[str, int] | None = None,
    wait_for_selector: str | None = None,
) -> dict[str, Any]:
    """Snapshot DOM text + computed styles + attributes for one CSS selector.

    Also returns ``page_errors`` and ``failed_requests`` captured during
    the page load — covers ~70% of what a console-log buffer would catch
    for runtime errors (the rest is deferred to Phase 2.5).
    """
    app_id = _get_app_id(tool_context)
    if not app_id:
        return {"error": "no_app_uuid_in_state"}

    result = await _capture_browser_state(
        app_id,
        path=path,
        selector=selector,
        viewport=viewport,
        want_screenshot=False,
        wait_for_selector=wait_for_selector,
    )
    if result.get("error"):
        _record_probe(tool_context, "read_browser_state_tool", result)
        return result
    dom = result.get("dom") or {}
    final = {
        "text_content": dom.get("text_content", ""),
        "computed_styles": dom.get("computed_styles", {}),
        "attributes": dom.get("attributes", {}),
        "page_errors": result.get("page_errors", []),
        "failed_requests": result.get("failed_requests", []),
        "duration_ms": result.get("duration_ms"),
    }
    _record_probe(tool_context, "read_browser_state_tool", final)
    return final


read_browser_state_tool = FunctionTool(read_browser_state_tool_impl)


# ---------------------------------------------------------------------------
# Public exports
# ---------------------------------------------------------------------------


# Class A — always registered (no auth surface, no external network).
SURVEYOR_NEW_TOOLS = [
    infer_handler_return_shape_tool,
    infer_consumer_field_reads_tool,
    field_mismatch_report_tool,
    prior_turn_diff_tool,
    prior_turn_diagnosis_tool,
    code_revision_diff_tool,
]


# Class B — runtime probes, gated by SURVEYOR_RUNTIME_PROBES_ENABLED in
# config.py. Surveyor builds its tool list from SURVEYOR_NEW_TOOLS plus
# this list when the flag is on.
SURVEYOR_CLASS_B_TOOLS = [
    execute_handler_tool,
    query_db_tool,
    sample_table_tool,
    screenshot_preview_tool,
    read_browser_state_tool,
]
