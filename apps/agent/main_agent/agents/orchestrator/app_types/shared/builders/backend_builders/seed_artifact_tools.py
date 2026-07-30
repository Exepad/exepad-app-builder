"""
Artifact tools for the SeedDataBuilder agent.

Validates and saves generated seed datasets as CSV artifacts.
Each dataset is saved as a separate artifact: seed:{name}.csv
"""

import json
import json_repair as _json_repair
import structlog
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

from main_agent.agents.utils.csv_utils import records_to_csv, compute_content_hash
from main_agent.constants import StateKeys

logger = structlog.get_logger(__name__)

_MAX_SEED_TOOL_CALLS = 10

# Session-state key written by ``BackendBuilder`` before the seed agent runs.
# Holds the JSON-serialised ``SeedDataBuilderInput`` which in turn carries the
# ``model_plans`` list with per-column ``enum_values``. The validator reads
# this to check every seed row against its declared vocabulary.
_SEED_INPUT_STATE_KEY = "_backend_build_seed_input"


def _extract_enum_column_map(state: dict) -> dict[str, dict[str, list[str]]]:
    """Return ``{model_name: {column_name: [allowed, ...]}}`` from state.

    Reads ``_backend_build_seed_input`` (written by ``BackendBuilder``) and
    walks its ``model_plans``. Missing, malformed, or empty entries are
    skipped silently — a missing input means the seed builder ran outside
    its normal harness and the check degrades to a no-op. The check is a
    safety net on top of the LLM instruction, not a replacement for it.
    """
    raw = state.get(_SEED_INPUT_STATE_KEY)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}

    enum_map: dict[str, dict[str, list[str]]] = {}
    for model in parsed.get("model_plans", []) or []:
        if not isinstance(model, dict):
            continue
        model_name = model.get("name")
        if not model_name:
            continue
        columns = model.get("columns", []) or []
        col_enums: dict[str, list[str]] = {}
        for col in columns:
            if not isinstance(col, dict):
                continue
            # Casing-robust read. Today the seed input is always
            # ``ColumnPlan.model_dump()`` (snake ``enum_values``), so the camel
            # branch is a defensive belt, not an active fix: if a future refactor
            # ever feeds this a camel-``enumValues`` model dict, the runtime-
            # enforced vocabulary must still gate seed rows rather than silently
            # escape. Harmless when snake is present (the OR short-circuits).
            values = col.get("enum_values") or col.get("enumValues")
            col_name = col.get("name")
            if col_name and isinstance(values, list) and values:
                col_enums[col_name] = [str(v) for v in values]
        if col_enums:
            enum_map[model_name] = col_enums
    return enum_map


def _validate_records_against_enums(
    dataset_name: str,
    records: list[dict],
    enum_map: dict[str, dict[str, list[str]]],
) -> list[str]:
    """Return a list of error strings for seed rows that violate ``enum_values``.

    Empty list = all clear. Errors include the dataset, column, offending
    value, and the allowed vocabulary so the retrying LLM sees exactly
    what to change.
    """
    column_enums = enum_map.get(dataset_name)
    if not column_enums:
        return []

    errors: list[str] = []
    for idx, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        for col_name, allowed in column_enums.items():
            if col_name not in record:
                continue
            value = record[col_name]
            if value is None:
                continue
            # Enum comparison is case-sensitive — same rule components use.
            if str(value) not in allowed:
                errors.append(
                    f"Dataset '{dataset_name}': row {idx} column '{col_name}' = "
                    f"{value!r} is not in enum_values {allowed}. Replace with "
                    f"one of these exact strings."
                )
    return errors


def _is_structurally_balanced(s: str) -> bool:
    """True when braces/brackets are balanced OUTSIDE string literals.

    A cheap structural-completeness check that tells a control-char-damaged but
    COMPLETE payload (recoverable) from one TRUNCATED mid-structure by an
    output-token cap (NOT recoverable — closing the brackets would silently
    drop the missing rows). String-aware so a brace inside a value or a raw
    control char inside a string (the exact damage we DO want to recover) never
    trips it.
    """
    depth = 0
    in_str = False
    escaped = False
    for ch in s:
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0 and not in_str


def _parse_seed_output_json(seed_output_json: str) -> dict | None:
    """Parse the LLM's seed JSON, tolerating raw control characters.

    Strict ``json.loads`` first (the happy path is unchanged); on
    ``JSONDecodeError`` fall back to the repo's tolerant parser
    (``json_repair``) — BUT only when the payload is structurally complete.
    Weak models routinely emit an unescaped newline/tab inside a
    notes/description string value despite the SeedDataBuilder prompt rule,
    which strict JSON (RFC 8259) rejects; recovering that preserves every row.
    A payload TRUNCATED mid-array by an output-token cap is different: json_repair
    would happily close the open brackets and return only the rows that fit,
    saving a partial dataset as if complete. We refuse to recover that case so a
    retrying model re-rolls the full dataset instead of silently shipping fewer
    rows. Returns the parsed object, or ``None`` when the payload is truncated,
    the tolerant parse fails, or the result is not a dict.
    """
    try:
        parsed = json.loads(seed_output_json)
    except json.JSONDecodeError as e:
        if not _is_structurally_balanced(seed_output_json):
            logger.error(
                "Seed data JSON is structurally incomplete (likely truncated by an "
                "output-token cap) — refusing json_repair to avoid silently saving "
                f"partial rows; a retry can re-roll the full dataset: {e}"
            )
            return None
        logger.warning(f"Seed data strict JSON parse failed ({e}); retrying with json_repair")
        try:
            parsed = _json_repair.loads(seed_output_json)
        except Exception as e2:  # pragma: no cover - json_repair almost never raises
            logger.error(f"Seed data JSON parse error (repair failed): {e2}")
            return None
    return parsed if isinstance(parsed, dict) else None


async def validate_and_save_seed_artifact(tool_context: ToolContext, seed_output_json: str) -> dict:
    """
    Validate and save generated seed datasets as CSV artifacts.

    Expects a JSON string with the structure:
    {
      "datasets": [
        {
          "name": "products",
          "records": [{"id": 1, "title": "Widget", "price": 9.99}, ...],
          "schema_fields": [
            {"name": "id", "type": "number"},
            {"name": "title", "type": "string"},
            {"name": "price", "type": "currency", "label": "Price"}
          ]
        }
      ]
    }

    Saves each dataset as:
    - seed:{name}.csv -- CSV content
    - seed_schema:{name}.json -- schema metadata

    Also stores seed_data_metadata in session state for config assembly.

    Args:
        seed_output_json: JSON string containing the datasets array.

    Returns:
        Dict with save status and summary.
    """
    try:
        # Safety cap: prevent runaway tool-call loops
        call_key = "_seed_tool_total_calls"
        call_count = tool_context.state.get(call_key, 0) + 1
        tool_context.state[call_key] = call_count

        if call_count > _MAX_SEED_TOOL_CALLS:
            logger.warning(f"Seed tool call cap reached ({call_count}), telling agent to stop")
            tool_context.actions.escalate = True
            return {
                "success": True,
                "terminal": True,
                "summary": (
                    f"STOP — seed data tool called {call_count} times. "
                    "Do NOT call this tool again. Move on to the next task."
                ),
            }

        parsed = _parse_seed_output_json(seed_output_json)
        if parsed is None:
            return {"success": False, "error": "Invalid JSON: could not parse seed datasets."}
        if "datasets" not in parsed:
            return {
                "success": False,
                "error": "Expected a JSON object with a 'datasets' array.",
            }

        datasets = parsed["datasets"]
        if not isinstance(datasets, list):
            return {"success": False, "error": "'datasets' must be an array."}

        errors = []
        saved = []
        seed_metadata = {}

        # Build the per-column ``enum_values`` map once per tool call so we
        # can reject rows whose status/priority/etc. fall outside the
        # vocabulary the Creator declared in ``ColumnPlan.enum_values``.
        enum_map = _extract_enum_column_map(tool_context.state)

        for ds in datasets:
            name = ds.get("name", "")
            records = ds.get("records", [])
            schema_fields = ds.get("schema_fields", [])

            if not name:
                errors.append("Dataset missing 'name' field.")
                continue
            if not isinstance(records, list) or len(records) == 0:
                errors.append(f"Dataset '{name}': 'records' must be a non-empty array.")
                continue
            if not isinstance(records[0], dict):
                errors.append(f"Dataset '{name}': each record must be a JSON object.")
                continue

            enum_errors = _validate_records_against_enums(name, records, enum_map)
            if enum_errors:
                errors.extend(enum_errors)
                # Skip saving this dataset — the LLM will retry with the
                # specific errors included in the returned summary.
                continue

            try:
                csv_content = records_to_csv(records)
            except Exception as e:
                errors.append(f"Dataset '{name}': CSV serialization failed: {e}")
                continue

            content_hash = compute_content_hash(csv_content)

            csv_bytes = csv_content.encode("utf-8")
            csv_artifact = genai.types.Part.from_bytes(data=csv_bytes, mime_type="text/csv")
            csv_version = await tool_context.save_artifact(
                filename=f"seed:{name}.csv", artifact=csv_artifact
            )

            schema_data = {"fields": schema_fields, "primaryKey": "id"}
            schema_bytes = json.dumps(
                schema_data, separators=(",", ":"), ensure_ascii=False
            ).encode("utf-8")
            schema_artifact = genai.types.Part.from_bytes(
                data=schema_bytes, mime_type="application/json"
            )
            await tool_context.save_artifact(
                filename=f"seed_schema:{name}.json", artifact=schema_artifact
            )

            seed_metadata[name] = {
                "csv_content": csv_content,
                "content_hash": content_hash,
                "records": records,
                "schema": schema_data,
                "record_count": len(records),
            }

            saved.append(name)
            logger.info(
                f"Saved seed artifact: seed:{name}.csv v{csv_version} "
                f"({len(records)} records, {len(csv_bytes)} bytes, hash={content_hash})"
            )

        tool_context.state[StateKeys.SEED_DATA_METADATA] = seed_metadata

        if errors:
            return {
                "success": len(saved) > 0,
                "saved_datasets": saved,
                "errors": errors,
                "summary": f"Saved {len(saved)} dataset(s), {len(errors)} error(s).",
            }

        return {
            "success": True,
            "saved_datasets": saved,
            "summary": "Saved {} dataset(s): {}".format(
                len(saved),
                ", ".join(
                    "{} ({} rows)".format(n, seed_metadata[n]["record_count"]) for n in saved
                ),
            ),
        }

    except Exception as e:
        logger.error(f"Failed to save seed artifacts: {e}")
        return {"success": False, "error": str(e)}


validate_and_save_seed_artifact_tool = FunctionTool(validate_and_save_seed_artifact)
