"""Unit tests for agent_api._iter_with_cancel — the interruptible-iteration
helper that lets a Stop abort an in-flight /r run mid-phase (even while awaiting
the next event, which during a long ComponentBuilder phase can be tens of
seconds with no yields)."""

import asyncio

import pytest

import agent_api


@pytest.mark.unit
@pytest.mark.asyncio
async def test_yields_all_items_when_not_cancelled():
    """No cancel → identical to iterating the generator directly."""

    async def gen():
        for i in range(5):
            yield i

    cancel = asyncio.Event()
    out = [x async for x in agent_api._iter_with_cancel(gen(), cancel)]
    assert out == [0, 1, 2, 3, 4]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_closes_underlying_generator_on_exhaustion():
    """The wrapped generator's finally/aclose runs (resource cleanup)."""
    closed = {"v": False}

    async def gen():
        try:
            yield 1
            yield 2
        finally:
            closed["v"] = True

    cancel = asyncio.Event()
    out = [x async for x in agent_api._iter_with_cancel(gen(), cancel)]
    assert out == [1, 2]
    assert closed["v"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_aborts_when_cancel_set_between_items():
    """Cancel set after some items → stop yielding + close the generator."""
    closed = {"v": False}

    async def gen():
        try:
            for i in range(100):
                yield i
                await asyncio.sleep(0)
        finally:
            closed["v"] = True

    cancel = asyncio.Event()
    out = []
    async for x in agent_api._iter_with_cancel(gen(), cancel):
        out.append(x)
        if x == 2:
            cancel.set()  # request cancel; next race should abort
    assert out[-1] == 2
    assert len(out) <= 4  # aborted promptly, not all 100
    assert closed["v"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_aborts_during_a_slow_pending_item():
    """The key case: cancel fires while awaiting a slow next item (a long
    phase). Must abort within ~the cancel latency, NOT wait for the item."""
    closed = {"v": False}

    async def gen():
        try:
            yield "first"
            await asyncio.sleep(30)  # simulates a long phase with no yields
            yield "should-never-arrive"
        finally:
            closed["v"] = True

    cancel = asyncio.Event()

    async def trip_cancel():
        await asyncio.sleep(0.2)
        cancel.set()

    asyncio.ensure_future(trip_cancel())

    out = []
    started = asyncio.get_event_loop().time()
    async for x in agent_api._iter_with_cancel(gen(), cancel):
        out.append(x)
    elapsed = asyncio.get_event_loop().time() - started

    assert out == ["first"]  # the post-sleep yield never arrived
    assert elapsed < 5  # aborted ~0.2s in, did NOT wait the 30s sleep
    assert closed["v"] is True
