"""Unit tests for the Gemini thought-signature / function_call preservation fix.

Locks the contract that the before/after model callbacks:

  * DROP pure thought text parts (model internal reasoning) to save tokens,
  * PRESERVE function_call parts — including their ``thought`` and
    ``thought_signature`` fields — exactly as received (the Gemini API rejects
    requests where those signatures are missing or altered), and
  * preserve part ORDERING and handle empty / malformed input safely.

Both callbacks are sync (ADK invokes them directly), so these are sync tests.
The duration-timing side channel (``_llm_call_starts``) is exercised too, since
a leaked stack entry across runs would silently mis-attribute LLM wall-clock.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.utils import thought_signature_fix as tsf
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_from_response,
    strip_thinking_metadata,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Part / message builders (mirror the SimpleNamespace harness used by the
# sibling tool_call_normalizer tests — no real ADK objects needed).
# --------------------------------------------------------------------------- #
def _thought_text(text: str = "internal reasoning"):
    """A pure-thought text part: thought=True, has text, no function call/response."""
    return SimpleNamespace(
        thought=True,
        text=text,
        function_call=None,
        function_response=None,
    )


def _plain_text(text: str = "user-visible answer"):
    """A normal (non-thought) text part."""
    return SimpleNamespace(
        thought=False,
        text=text,
        function_call=None,
        function_response=None,
    )


def _function_call(name: str = "sys_create", signature: str = "sig-abc"):
    """A function_call part carrying a thought_signature (must be preserved)."""
    return SimpleNamespace(
        thought=True,  # Gemini 3 marks function_call parts as thought too
        text=None,
        thought_signature=signature,
        function_call=SimpleNamespace(name=name, args={}),
        function_response=None,
    )


def _function_response(name: str = "sys_create"):
    return SimpleNamespace(
        thought=False,
        text=None,
        function_call=None,
        function_response=SimpleNamespace(name=name, response={}),
    )


def _content(parts):
    return SimpleNamespace(parts=parts)


def _response(content):
    return SimpleNamespace(content=content)


def _request(contents):
    return SimpleNamespace(contents=contents)


def _ctx(agent_name: str = "ComponentBuilder"):
    return SimpleNamespace(agent_name=agent_name)


@pytest.fixture(autouse=True)
def _clear_call_starts():
    """Isolate the module-level timing stack between tests."""
    tsf._llm_call_starts.clear()
    yield
    tsf._llm_call_starts.clear()


# --------------------------------------------------------------------------- #
# strip_thinking_from_response — the "after model" callback
# --------------------------------------------------------------------------- #
def test_function_call_part_and_its_signature_are_preserved():
    fc = _function_call(name="sys_update", signature="encrypted-snapshot")
    resp = _response(_content([fc]))

    out = strip_thinking_from_response(_ctx(), resp)

    assert out is None  # callback returns None → ADK keeps the (cleaned) response
    parts = resp.content.parts
    assert parts == [fc]
    assert parts[0].function_call.name == "sys_update"
    # The mandatory signature survives byte-for-byte.
    assert parts[0].thought_signature == "encrypted-snapshot"


def test_pure_thought_text_is_stripped():
    resp = _response(_content([_thought_text("secret chain of thought")]))

    strip_thinking_from_response(_ctx(), resp)

    # Safety rule: never leave zero parts — original kept when ALL parts dropped.
    assert resp.content.parts  # not emptied
    assert resp.content.parts == [resp.content.parts[0]]


def test_thought_text_dropped_but_function_call_kept_and_order_preserved():
    thought = _thought_text("reasoning before the call")
    fc = _function_call(name="sys_list", signature="sig-1")
    plain = _plain_text("here is the result")
    resp = _response(_content([thought, fc, plain]))

    strip_thinking_from_response(_ctx(), resp)

    parts = resp.content.parts
    # thought text removed; function_call + plain text survive in original order
    assert parts == [fc, plain]
    assert parts[0].function_call.name == "sys_list"
    assert parts[0].thought_signature == "sig-1"


def test_non_thought_text_passes_through_unchanged():
    plain = _plain_text("normal answer")
    resp = _response(_content([plain]))

    strip_thinking_from_response(_ctx(), resp)

    assert resp.content.parts == [plain]


def test_function_response_part_passes_through():
    fr = _function_response("sys_read")
    resp = _response(_content([fr]))

    strip_thinking_from_response(_ctx(), resp)

    assert resp.content.parts == [fr]


def test_all_parts_are_thoughts_keeps_original_parts():
    t1 = _thought_text("a")
    t2 = _thought_text("b")
    resp = _response(_content([t1, t2]))

    strip_thinking_from_response(_ctx(), resp)

    # cleaned_parts would be empty → module deliberately keeps the originals.
    assert resp.content.parts == [t1, t2]


def test_response_with_no_content_is_safe():
    assert strip_thinking_from_response(_ctx(), _response(None)) is None


def test_response_with_empty_parts_is_safe():
    resp = _response(_content([]))
    assert strip_thinking_from_response(_ctx(), resp) is None
    assert resp.content.parts == []


def test_response_with_none_parts_is_safe():
    resp = _response(_content(None))
    assert strip_thinking_from_response(_ctx(), resp) is None


def test_thought_marked_part_without_text_is_not_stripped():
    # thought=True but text is empty → NOT a "pure thought text" part; kept.
    weird = SimpleNamespace(
        thought=True, text="", function_call=None, function_response=None
    )
    resp = _response(_content([weird]))

    strip_thinking_from_response(_ctx(), resp)

    assert resp.content.parts == [weird]


# --------------------------------------------------------------------------- #
# strip_thinking_metadata — the "before model" callback (history cleanup)
# --------------------------------------------------------------------------- #
def test_history_function_call_and_signature_preserved():
    fc = _function_call(name="sys_delete", signature="hist-sig")
    req = _request([_content([fc])])

    out = strip_thinking_metadata(_ctx(), req)

    assert out is None
    parts = req.contents[0].parts
    assert parts == [fc]
    assert parts[0].thought_signature == "hist-sig"


def test_history_thought_text_stripped_calls_kept_order_preserved():
    thought = _thought_text("history reasoning")
    fc = _function_call(name="sys_create", signature="s")
    plain = _plain_text("turn text")
    req = _request([_content([thought, fc, plain])])

    strip_thinking_metadata(_ctx(), req)

    assert req.contents[0].parts == [fc, plain]


def test_history_all_thoughts_in_one_content_kept_intact():
    t1 = _thought_text("only")
    t2 = _thought_text("thoughts")
    req = _request([_content([t1, t2])])

    strip_thinking_metadata(_ctx(), req)

    # Zero-part safety: keep originals so the turn structure isn't broken.
    assert req.contents[0].parts == [t1, t2]


def test_history_multiple_contents_cleaned_independently():
    c0 = _content([_thought_text("drop me"), _plain_text("keep me")])
    fc = _function_call(name="sys_update", signature="x")
    c1 = _content([fc])
    req = _request([c0, c1])

    strip_thinking_metadata(_ctx(), req)

    assert len(req.contents[0].parts) == 1
    assert req.contents[0].parts[0].text == "keep me"
    assert req.contents[1].parts == [fc]


def test_history_empty_and_partless_contents_are_skipped():
    fc = _function_call()
    req = _request([None, _content(None), _content([]), _content([fc])])

    out = strip_thinking_metadata(_ctx(), req)

    assert out is None
    assert req.contents[3].parts == [fc]


def test_history_empty_contents_list_is_safe():
    req = _request([])
    assert strip_thinking_metadata(_ctx(), req) is None


# --------------------------------------------------------------------------- #
# Per-call timing side channel (_llm_call_starts)
# --------------------------------------------------------------------------- #
def test_timing_stack_pushed_on_request_and_popped_on_response():
    agent = "DesignImporter"
    req = _request([_content([_plain_text("go")])])

    strip_thinking_metadata(_ctx(agent), req)
    # One pending start recorded for this agent.
    assert tsf._llm_call_starts.get(agent) and len(tsf._llm_call_starts[agent]) == 1

    resp = _response(_content([_plain_text("done")]))
    strip_thinking_from_response(_ctx(agent), resp)

    # Stack drained → key removed so it can't leak across runs.
    assert agent not in tsf._llm_call_starts


def test_timing_nested_calls_stack_and_unwind_in_lifo_order():
    agent = "ComponentBuilder"
    req = _request([_content([_plain_text("a")])])

    strip_thinking_metadata(_ctx(agent), req)
    strip_thinking_metadata(_ctx(agent), req)
    assert len(tsf._llm_call_starts[agent]) == 2

    resp = _response(_content([_plain_text("a")]))
    strip_thinking_from_response(_ctx(agent), resp)
    assert len(tsf._llm_call_starts[agent]) == 1

    strip_thinking_from_response(_ctx(agent), resp)
    assert agent not in tsf._llm_call_starts


def test_response_without_matching_start_does_not_crash():
    # A stray after-callback with no recorded start must not raise.
    resp = _response(_content([_plain_text("orphan")]))
    assert strip_thinking_from_response(_ctx("NeverStarted"), resp) is None


def test_missing_agent_name_falls_back_to_unknown():
    ctx = SimpleNamespace()  # no agent_name attribute
    req = _request([_content([_plain_text("hi")])])

    strip_thinking_metadata(ctx, req)

    assert "unknown" in tsf._llm_call_starts
