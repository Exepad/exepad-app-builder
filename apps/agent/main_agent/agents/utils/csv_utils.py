"""
CSV serialization utilities for seed data.

Produces RFC 4180 CSV compatible with r2-seeder.ts:parseCSVString().
"""

import csv
import hashlib
import io


def records_to_csv(records: list[dict]) -> str:
    """Convert a list of dicts to an RFC 4180 CSV string.

    All records must share the same set of keys. Column order is determined
    by the first record's key order.

    Args:
        records: Non-empty list of flat dicts (no nested objects).

    Returns:
        CSV string with header row and data rows. Uses \\r\\n line endings
        for maximum compatibility with the runtime parser.
    """
    if not records:
        return ""

    columns = list(records[0].keys())
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(columns)

    for row in records:
        writer.writerow(_serialize_value(row.get(col)) for col in columns)

    return buf.getvalue()


def compute_content_hash(content: str, length: int = 12) -> str:
    """SHA-256 content hash (first *length* hex chars).

    Matches the content-hash convention used for versioned source file paths
    (``{name}_{hash}_v{rev}.{ext}``).
    """
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:length]


def _serialize_value(value) -> str:
    """Serialize a Python value to a CSV cell string.

    Mirrors the auto-casting rules in r2-seeder.ts so the round-trip
    is lossless:
      None -> ""  (parsed back as null)
      bool -> "true"/"false"
      int/float -> str(value)
      list/dict -> json string
      str -> str
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        import json

        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    return str(value)
