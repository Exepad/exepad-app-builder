"""Unit tests for the hallucinated-tool-name normalizer.

Locks the contract that a near-miss tool name (e.g. ``load_artifact`` for the
ADK built-in ``load_artifacts``) is rewritten to the canonical name before ADK's
exact-match tool resolution — so a single fumbled name from a weaker model can't
hard-crash the build.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.utils.tool_call_normalizer import normalize_tool_call_names

pytestmark = [pytest.mark.unit]


def _fc(name: str):
    """A part carrying a function_call with a mutable .name."""
    return SimpleNamespace(function_call=SimpleNamespace(name=name, args={}), text=None)


def _resp(parts):
    return SimpleNamespace(content=SimpleNamespace(parts=parts))


def _ctx():
    return SimpleNamespace(agent_name="ComponentBuilder")


def test_rewrites_known_alias():
    resp = _resp([_fc("load_artifact")])
    out = normalize_tool_call_names(_ctx(), resp)
    assert out is resp  # non-None return → ADK replaces the response
    assert resp.content.parts[0].function_call.name == "load_artifacts"


def test_leaves_valid_name_untouched_returns_none():
    resp = _resp([_fc("load_artifacts")])
    out = normalize_tool_call_names(_ctx(), resp)
    assert out is None
    assert resp.content.parts[0].function_call.name == "load_artifacts"


def test_unknown_name_not_guessed():
    # An unmapped name is left alone (no wild fuzzy rewrite that could mask a
    # genuinely unknown tool); ADK's normal path handles it.
    resp = _resp([_fc("totally_made_up_tool")])
    out = normalize_tool_call_names(_ctx(), resp)
    assert out is None
    assert resp.content.parts[0].function_call.name == "totally_made_up_tool"


def test_mixed_parts_text_and_calls():
    text_part = SimpleNamespace(function_call=None, text="some reasoning")
    resp = _resp([text_part, _fc("load_artifact")])
    out = normalize_tool_call_names(_ctx(), resp)
    assert out is resp
    assert resp.content.parts[1].function_call.name == "load_artifacts"


def test_none_response_and_empty_content_are_safe():
    assert normalize_tool_call_names(_ctx(), None) is None
    assert normalize_tool_call_names(_ctx(), SimpleNamespace(content=None)) is None
    assert normalize_tool_call_names(_ctx(), _resp(None)) is None
    assert normalize_tool_call_names(_ctx(), _resp([])) is None
