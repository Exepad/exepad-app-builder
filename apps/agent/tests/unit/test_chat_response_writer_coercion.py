"""Unit tests for the ChatResponseWriter plain-text → schema coercion callback.

A weak / non-Gemini model routinely emits the final "here's your app" message
as PLAIN TEXT (or a fenced JSON block) instead of the required
``ChatResponseWriterOutput`` JSON. Before the fix, ADK's ``output_schema`` parse
raised a ``ValidationError`` (json_invalid), burning a retry and dumping a
multi-thousand-line traceback. The ``_coerce_plaintext_response``
``after_model_callback`` rewrites such a response so ADK parses it on attempt 1.
Observed live on app amcd4goxv (2026-07-12), deepseek-v4-flash via OpenRouter.
"""

from __future__ import annotations

import pytest
from google.genai import types
from google.adk.models.llm_response import LlmResponse
from google.adk.utils._schema_utils import validate_schema

from main_agent.agents.orchestrator.app_types.shared.subagents.chat_response_writer import (
    ChatResponseWriterOutput,
    _coerce_plaintext_response,
)

pytestmark = [pytest.mark.unit]


def _resp(text: str) -> LlmResponse:
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))


def _text(resp: LlmResponse) -> str:
    return "".join(p.text for p in resp.content.parts if p.text)


def _parses(resp: LlmResponse) -> bool:
    try:
        validate_schema(ChatResponseWriterOutput, _text(resp).strip())
        return True
    except Exception:
        return False


class TestCoercePlaintextResponse:
    def test_plain_prose_is_wrapped_and_now_parses(self):
        # The exact observed failure shape.
        r = _resp("Your Crate app is up and running — take a look and tell me if it looks right.")
        out = _coerce_plaintext_response(None, r)
        assert out is r  # mutated + returned
        assert _parses(r)
        parsed = ChatResponseWriterOutput.model_validate_json(_text(r))
        assert parsed.result_chat_response.startswith("Your Crate app")

    def test_valid_json_is_left_untouched(self):
        original = '{"result_chat_response":"Done!","conversation_message_summary":null}'
        r = _resp(original)
        out = _coerce_plaintext_response(None, r)
        assert out is None  # nothing to do
        assert _text(r) == original

    def test_fenced_json_is_unwrapped_to_bare_json(self):
        r = _resp('```json\n{"result_chat_response":"Built it."}\n```')
        out = _coerce_plaintext_response(None, r)
        assert out is r
        assert _parses(r)
        assert (
            ChatResponseWriterOutput.model_validate_json(_text(r)).result_chat_response
            == "Built it."
        )

    def test_single_line_fenced_json_is_coerced_not_shipped_empty(self):
        # Review Finding 1 (HIGH): a one-line fenced JSON (no newline after the
        # opening fence) previously made _strip_code_fence return "" → the empty
        # string got wrapped → the user saw the literal {'result_chat_response':''}.
        # It must now extract the real message.
        r = _resp('```json {"result_chat_response":"Your app is ready"}```')
        out = _coerce_plaintext_response(None, r)
        assert out is r
        assert _parses(r)
        assert (
            ChatResponseWriterOutput.model_validate_json(_text(r)).result_chat_response
            == "Your app is ready"
        )

    def test_bare_or_empty_fence_falls_back_to_retry_never_ships_empty(self):
        # Review Finding 1: fence-strips-to-empty inputs must be LEFT for the
        # retry service (return None), never wrapped as "".
        for blank_fence in ("```", "```json", "```\n\n```", "```json\n```"):
            r = _resp(blank_fence)
            out = _coerce_plaintext_response(None, r)
            assert out is None, f"{blank_fence!r} should be left for retry"
            assert _text(r) == blank_fence  # unchanged, not wrapped as empty

    def test_truncated_json_is_left_for_retry_not_miswrapped(self):
        # JSON-shaped but invalid → the retry service re-rolls it; wrapping a
        # partial JSON blob as the user-visible message would be worse.
        truncated = '{"result_chat_response":"Built the app with a records table'
        r = _resp(truncated)
        out = _coerce_plaintext_response(None, r)
        assert out is None
        assert _text(r) == truncated
        assert not _parses(r)

    def test_empty_or_whitespace_is_left_untouched(self):
        for blank in ("", "   ", "\n\t "):
            r = _resp(blank)
            assert _coerce_plaintext_response(None, r) is None

    def test_no_content_is_safe(self):
        assert _coerce_plaintext_response(None, LlmResponse(content=None)) is None
        empty = LlmResponse(content=types.Content(role="model", parts=[]))
        assert _coerce_plaintext_response(None, empty) is None

    def test_prose_with_special_chars_survives_json_roundtrip(self):
        # Quotes / newlines / unicode in the prose must be JSON-escaped, not
        # break the wrapped payload.
        msg = 'Built "Crate" — 2 pages,\na records table. Ünïcode ok.'
        r = _resp(msg)
        _coerce_plaintext_response(None, r)
        assert _parses(r)
        assert ChatResponseWriterOutput.model_validate_json(_text(r)).result_chat_response == msg


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
