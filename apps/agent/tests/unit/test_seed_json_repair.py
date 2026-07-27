"""Seed-data JSON parse robustness (2026-06-27).

Weak models routinely emit a raw control character (an unescaped newline/tab
inside a notes/description string value) despite the SeedDataBuilder prompt rule
forbidding multiline content. Strict ``json.loads`` rejects those (RFC 8259), so
``validate_and_save_seed_artifact`` used to return ``{"success": False}`` and the
LLM had to re-roll — on a non-retrying model the affected datasets are then
SILENTLY DROPPED (tables ship empty, no deploy error). Live repro: LedgerLite
build hit "Seed data JSON parse error: Invalid control character at: line 49
column 105"; it only recovered because that retry happened to emit clean JSON.

The fix: on ``JSONDecodeError`` fall back to the repo's tolerant parser
(``json_repair``) before failing. These tests prove the dataset is recovered
without a retry, and that genuine garbage still fails gracefully.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.seed_artifact_tools import (  # noqa: E501
    validate_and_save_seed_artifact,
)

pytestmark = [pytest.mark.unit]


class _Ctx:
    """Minimal ToolContext: empty state (no enum map → no enum validation),
    an ``actions`` namespace, and an async ``save_artifact`` that records calls."""

    def __init__(self) -> None:
        self.state: dict = {}
        self.actions = SimpleNamespace(escalate=False)
        self.saved: dict = {}

    async def save_artifact(self, filename, artifact):
        self.saved[filename] = artifact
        return 0


# A seed payload with a RAW newline inside a string value — the exact failure
# class. The ``\n`` below is a literal newline in the JSON string, which strict
# json.loads rejects with "Invalid control character".
_SEED_WITH_CTRL_CHAR = (
    '{"datasets":[{"name":"invoices",'
    '"schema_fields":[{"name":"id","type":"integer"},{"name":"notes","type":"text"}],'
    '"records":[{"id":1,"notes":"Line one\nLine two"},{"id":2,"notes":"ok"}]}]}'
)


def test_seed_tool_recovers_raw_control_char_via_json_repair():
    ctx = _Ctx()
    result = asyncio.run(validate_and_save_seed_artifact(ctx, _SEED_WITH_CTRL_CHAR))
    # Before the fix: strict json.loads raised → success False, nothing saved.
    assert result["success"] is True
    assert result["saved_datasets"] == ["invoices"]
    assert "seed:invoices.csv" in ctx.saved
    # The two records survived (the newline value was preserved, not dropped).
    csv_bytes = ctx.saved["seed:invoices.csv"].inline_data.data
    csv_text = csv_bytes.decode("utf-8") if isinstance(csv_bytes, bytes) else csv_bytes
    assert "Line one" in csv_text


def test_seed_tool_happy_path_unchanged():
    ctx = _Ctx()
    clean = (
        '{"datasets":[{"name":"tasks",'
        '"schema_fields":[{"name":"id","type":"integer"}],'
        '"records":[{"id":1},{"id":2}]}]}'
    )
    result = asyncio.run(validate_and_save_seed_artifact(ctx, clean))
    assert result["success"] is True
    assert result["saved_datasets"] == ["tasks"]


_SEED_TRUNCATED = (
    '{"datasets":[{"name":"invoices",'
    '"schema_fields":[{"name":"id","type":"integer"},{"name":"amount","type":"real"}],'
    '"records":[{"id":1,"amount":10},{"id":2,"amount":20},{"id":3,"amount":3'  # cut off mid-array
)


def test_seed_tool_refuses_truncated_payload_no_silent_partial():
    """A payload truncated mid-records (output-token cap) must NOT be silently
    completed by json_repair into a partial dataset — it fails so a retrying
    model re-rolls the full set. (Review finding, 2026-06-27.)"""
    ctx = _Ctx()
    result = asyncio.run(validate_and_save_seed_artifact(ctx, _SEED_TRUNCATED))
    assert result["success"] is False
    assert ctx.saved == {}


def test_seed_tool_genuine_garbage_fails_gracefully():
    ctx = _Ctx()
    result = asyncio.run(validate_and_save_seed_artifact(ctx, "this is not json at all"))
    # Either json_repair yields a non-dict (caught by the datasets guard) or the
    # repair fails — either way: a clean failure dict, no crash, nothing saved.
    assert result["success"] is False
    assert ctx.saved == {}
