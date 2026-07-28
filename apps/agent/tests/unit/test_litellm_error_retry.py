"""RetryingLiteLlm — re-roll empty provider errors that slip past num_retries.

Live finding (2026-06-27): a content-heavy build shipped HomeContent as a
placeholder because OpenRouter/deepseek returned a 200 with finish_reason='error'
(an empty body, mapped to FinishReason.OTHER). litellm's num_retries only fires on
EXCEPTIONS, so this empty response silently became a no-save. RetryingLiteLlm
re-rolls the non-stream call a few times with backoff on exactly this shape.
"""

from __future__ import annotations

import asyncio
import time

import pytest
from google.genai import types
from google.adk.models.llm_response import LlmResponse

import config

pytestmark = [pytest.mark.unit]


def _empty_error_response() -> LlmResponse:
    return LlmResponse(
        content=types.Content(role="model", parts=[]),
        finish_reason=types.FinishReason.OTHER,
    )


def _text_response(text: str = "hi") -> LlmResponse:
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        finish_reason=types.FinishReason.STOP,
    )


def _function_call_response() -> LlmResponse:
    fc = types.FunctionCall(name="validate_and_save_tsx_component_artifact", args={"code": "x"})
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(function_call=fc)]),
        finish_reason=types.FinishReason.STOP,
    )


# ---- detector ---------------------------------------------------------------


def test_detector_flags_empty_other():
    assert config._is_empty_provider_error([_empty_error_response()]) is True


def test_detector_ignores_text_response():
    assert config._is_empty_provider_error([_text_response()]) is False


def test_detector_ignores_function_call_response():
    assert config._is_empty_provider_error([_function_call_response()]) is False


def test_detector_ignores_empty_stop():
    """An empty STOP (model legitimately returned nothing) is NOT retried — only
    the OTHER/error bucket is."""
    resp = LlmResponse(
        content=types.Content(role="model", parts=[]), finish_reason=types.FinishReason.STOP
    )
    assert config._is_empty_provider_error([resp]) is False


def test_detector_flags_error_code():
    resp = LlmResponse(error_code="500", error_message="boom")
    assert config._is_empty_provider_error([resp]) is True


def test_detector_empty_list_is_false():
    assert config._is_empty_provider_error([]) is False


# ---- retry behaviour --------------------------------------------------------


def _make_instance():
    cls = config._get_retrying_litellm_class()
    return cls(model="openrouter/deepseek/deepseek-v4-flash")


def _patch_parent(monkeypatch, sequences):
    """Patch the LiteLlm parent's generate_content_async to yield, on successive
    calls, the responses from ``sequences`` (a list of lists)."""
    from google.adk.models.lite_llm import LiteLlm

    calls = {"n": 0}

    async def fake(self, llm_request, stream=False):
        idx = min(calls["n"], len(sequences) - 1)
        calls["n"] += 1
        for r in sequences[idx]:
            yield r

    monkeypatch.setattr(LiteLlm, "generate_content_async", fake, raising=True)
    return calls


def test_retries_empty_error_then_succeeds(monkeypatch):
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    calls = _patch_parent(
        monkeypatch,
        [[_empty_error_response()], [_function_call_response()]],
    )
    inst = _make_instance()

    async def run():
        out = []
        async for r in inst.generate_content_async(object(), stream=False):
            out.append(r)
        return out

    out = asyncio.run(run())
    assert calls["n"] == 2  # retried once
    assert len(out) == 1
    assert out[0].content.parts[0].function_call is not None  # the good response


def test_gives_up_after_attempts_and_yields_error(monkeypatch):
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    calls = _patch_parent(monkeypatch, [[_empty_error_response()]])  # always errors
    inst = _make_instance()

    async def run():
        out = []
        async for r in inst.generate_content_async(object(), stream=False):
            out.append(r)
        return out

    out = asyncio.run(run())
    assert calls["n"] == 3  # initial + 2 retries
    assert len(out) == 1  # still yields the terminal error so downstream handles it
    assert out[0].finish_reason == types.FinishReason.OTHER


def test_success_first_try_no_retry(monkeypatch):
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    calls = _patch_parent(monkeypatch, [[_function_call_response()]])
    inst = _make_instance()

    async def run():
        out = []
        async for r in inst.generate_content_async(object(), stream=False):
            out.append(r)
        return out

    out = asyncio.run(run())
    assert calls["n"] == 1  # no retry
    assert len(out) == 1


def test_stream_passthrough_no_buffering(monkeypatch):
    """Streaming must pass through unchanged (no retry, no buffering)."""
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    calls = _patch_parent(monkeypatch, [[_text_response("a"), _text_response("b")]])
    inst = _make_instance()

    async def run():
        out = []
        async for r in inst.generate_content_async(object(), stream=True):
            out.append(r)
        return out

    out = asyncio.run(run())
    assert calls["n"] == 1
    assert len(out) == 2  # both streamed chunks passed through


# ---- total wall-clock bound --------------------------------------------------
# Live finding (2026-07-13, root-caused 2026-07-25): litellm's `timeout=` is
# handed to httpx, whose timeouts are PER-OPERATION, so a provider that dribbles
# bytes resets the read clock and runs unbounded (measured: a 30s trickle sailed
# past timeout=5 and returned at 32.2s; the same endpoint stalling silently DID
# raise at 5.5s). RetryingLiteLlm adds a real total-elapsed ceiling.


def _patch_parent_slow(monkeypatch, delay: float, then=None, closed=None):
    """Parent whose generator sleeps ``delay`` before yielding — the trickle shape."""
    from google.adk.models.lite_llm import LiteLlm

    calls = {"n": 0}

    async def fake(self, llm_request, stream=False):
        calls["n"] += 1
        try:
            await asyncio.sleep(delay)
            yield (then or _function_call_response())
        finally:
            if closed is not None:
                closed.append(calls["n"])

    monkeypatch.setattr(LiteLlm, "generate_content_async", fake, raising=True)
    return calls


def _drain(inst, stream=False):
    async def run():
        out = []
        async for r in inst.generate_content_async(object(), stream=stream):
            out.append(r)
        return out

    return asyncio.run(run())


def test_wall_clock_abandons_a_call_that_outruns_the_budget(monkeypatch):
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 0)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.05)
    _patch_parent_slow(monkeypatch, delay=5.0)
    inst = _make_instance()

    out = _drain(inst)

    assert len(out) == 1
    assert out[0].error_code == "EXEPAD_CALL_WALL_CLOCK_TIMEOUT"


def test_wall_clock_timeout_does_not_raise_into_the_parallel_round(monkeypatch):
    """Must degrade, never raise: inside ADK's ParallelAgent TaskGroup an
    exception cancels every sibling slot, so one slow provider would kill the
    whole component round instead of one component."""
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 0)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.05)
    _patch_parent_slow(monkeypatch, delay=5.0)
    inst = _make_instance()

    _drain(inst)  # no exception escapes


def test_wall_clock_abandon_is_terminal_not_re_rolled(monkeypatch):
    """A wall-clock abandon spends the SHARED deadline by definition, so it can
    never buy another attempt — the call settles instead of burning re-rolls on a
    route that just proved it is too slow. (A fast empty-provider error leaves
    budget and IS still re-rolled — see the test below.)
    """
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.20)
    calls = _patch_parent_slow(monkeypatch, delay=5.0)
    inst = _make_instance()

    out = _drain(inst)

    assert calls["n"] == 1, "a spent budget must not buy a fresh provider attempt"
    assert out[0].error_code == "EXEPAD_CALL_WALL_CLOCK_TIMEOUT"


def test_wall_clock_closes_the_abandoned_generator(monkeypatch):
    """The abandoned call's generator is closed deterministically (aclosing),
    not left to GC holding the provider connection."""
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 0)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.05)
    closed: list = []
    _patch_parent_slow(monkeypatch, delay=5.0, closed=closed)
    inst = _make_instance()

    _drain(inst)

    assert closed == [1]


def test_wall_clock_zero_disables_the_bound(monkeypatch):
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 0)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.0)
    _patch_parent_slow(monkeypatch, delay=0.2)
    inst = _make_instance()

    out = _drain(inst)

    assert out[0].content.parts[0].function_call is not None


def test_wall_clock_leaves_a_fast_call_untouched(monkeypatch):
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 0)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 5.0)
    _patch_parent_slow(monkeypatch, delay=0.0, then=_text_response("ok"))
    inst = _make_instance()

    out = _drain(inst)

    assert out[0].content.parts[0].text == "ok"


def test_wall_clock_does_not_bound_a_stream(monkeypatch):
    """A long STREAM that is actively delivering tokens is healthy — bounding it
    would cut off legitimate long generations, so the stream path passes through."""
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.05)
    _patch_parent_slow(monkeypatch, delay=0.3, then=_text_response("streamed"))
    inst = _make_instance()

    out = _drain(inst, stream=True)

    assert out[0].content.parts[0].text == "streamed"


# ---- the budget is TOTAL, not per attempt ------------------------------------
# Adversarial review (2026-07-25) caught the first cut of this fix: the synthetic
# timeout response carries error_code, which _is_empty_provider_error treats as
# retryable, so a PER-ATTEMPT bound was multiplied by the re-roll loop —
# 300+3+300+6+300 = 909s against a 600s PARALLEL_BUILD_PHASE_TIMEOUT, i.e. the
# fix defeated the very invariant it was written to enforce.


def test_wall_clock_is_a_total_budget_across_re_rolls(monkeypatch):
    """N re-rolls must NOT multiply the ceiling."""
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.30)
    calls = _patch_parent_slow(monkeypatch, delay=5.0)  # always trickles
    inst = _make_instance()

    t0 = time.monotonic()
    out = _drain(inst)
    elapsed = time.monotonic() - t0

    # Per-attempt would have taken ~3 x 0.30s; total must stay near one budget.
    assert elapsed < 0.30 * 2, f"budget multiplied by the re-roll loop: {elapsed:.2f}s"
    assert out[0].error_code == "EXEPAD_CALL_WALL_CLOCK_TIMEOUT"
    assert calls["n"] >= 1


def test_wall_clock_skips_a_re_roll_that_cannot_fit_its_backoff(monkeypatch):
    """With no budget left for backoff + another call, settle instead of stalling."""
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 10.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 0.20)
    calls = _patch_parent_slow(monkeypatch, delay=5.0)
    inst = _make_instance()

    t0 = time.monotonic()
    out = _drain(inst)
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0, f"waited out a backoff it could not afford: {elapsed:.2f}s"
    assert calls["n"] == 1
    assert out[0].error_code == "EXEPAD_CALL_WALL_CLOCK_TIMEOUT"


def test_re_roll_still_works_when_the_budget_allows_it(monkeypatch):
    """The empty-provider re-roll must survive the shared-deadline change."""
    from google.adk.models.lite_llm import LiteLlm

    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_INITIAL_DELAY", 0.0)
    monkeypatch.setattr(config, "LITELLM_ERROR_FINISH_RETRIES", 2)
    monkeypatch.setattr(config, "LITELLM_CALL_WALL_CLOCK_SECONDS", 30.0)
    calls = {"n": 0}

    async def fake(self, llm_request, stream=False):
        calls["n"] += 1
        yield _empty_error_response() if calls["n"] == 1 else _function_call_response()

    monkeypatch.setattr(LiteLlm, "generate_content_async", fake, raising=True)
    inst = _make_instance()

    out = _drain(inst)

    assert calls["n"] == 2
    assert out[0].content.parts[0].function_call is not None


def test_default_budget_stays_under_the_tightest_phase_timeout():
    """The default is DERIVED from the phase budgets so it cannot drift past them."""
    tightest = min(config.PARALLEL_INITIAL_BUILDERS_TIMEOUT, config.PARALLEL_BUILD_PHASE_TIMEOUT)
    assert 0 < config.LITELLM_CALL_WALL_CLOCK_SECONDS < tightest
