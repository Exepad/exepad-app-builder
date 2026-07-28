"""Backend handler no-save resilience — Lever B (retry) + Lever C (stub/abort).

Pins the behavior added after the brewery build abzgxeo0 (2026-05-21), where one
no-artifact handler (`getUpcomingEvents`) aborted the whole build:
- a handler that produces no artifact is re-dispatched ONCE (retry), then
- if still missing, a crash-safe stub is written and the build continues
  (BACKEND_HANDLER_STUB_FALLBACK=true), or BuilderError is raised (false).
"""

from __future__ import annotations

from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.unit]

_GEN_MOD = (
    "main_agent.agents.orchestrator.app_types.shared.builders.backend_builders."
    "handler_code_generator"
)


def _make_handler_plan(name: str):
    from main_agent.agents.orchestrator.app_types.shared.models.plan_models import HandlerPlan

    return HandlerPlan(name=name, inputs=["x: text"], outputs=["ok: boolean"])


def _make_handler_input(name: str):
    from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_handler_builder import (  # noqa: E501
        BackendHandlerBuilderInput,
    )

    return BackendHandlerBuilderInput(
        handler_plan=_make_handler_plan(name), model_plans=[], output_artifact_name=name
    )


def _make_model_plan(name: str):
    from main_agent.agents.orchestrator.app_types.shared.models.plan_models import (
        ColumnPlan,
        ModelPlan,
    )

    return ModelPlan(name=name, columns=[ColumnPlan(name="title", type="text")])


def _make_ctx() -> MagicMock:
    ctx = MagicMock()
    ctx.session = MagicMock()
    ctx.session.state = {}
    return ctx


class _FakeAgentRun:
    def __init__(self):
        self.calls = 0

    def run_async(self, ctx) -> AsyncIterator:
        self.calls += 1

        async def _gen():
            event = MagicMock()
            event.usage_metadata = None
            yield event

        return _gen()


def _patches(gen, fake_agent, check_side_effect, save_stub, captured):
    """Common patch set; the ArtifactManager output-snapshot save appends the
    output_summary to ``captured`` so the test can read it after patches stop."""

    async def _capture_io(_ctx, _name, _kind, payload):
        captured.append(payload)

    return [
        patch.object(
            gen, "backend_handler_builder_agent", MagicMock(run_async=fake_agent.run_async)
        ),
        patch.object(gen, "push_prompt_to_next_agent", AsyncMock()),
        patch.object(gen, "_check_saved_artifacts", AsyncMock(side_effect=check_side_effect)),
        patch.object(gen, "_save_placeholder_handler", save_stub),
        patch.object(
            gen,
            "MetricsTracker",
            MagicMock(
                return_value=MagicMock(
                    start_agent=AsyncMock(),
                    record_tokens=AsyncMock(),
                    stop_agent=AsyncMock(return_value=None),
                )
            ),
        ),
        patch.object(
            gen.ArtifactManager, "save_agent_io_artifact", AsyncMock(side_effect=_capture_io)
        ),
    ]


async def _run(gen, ctx, names):
    return [
        e
        async for e in gen.generate_handler_code_artifacts(
            ctx,
            handler_plans=[_make_handler_plan(n) for n in names],
            model_plans=[_make_model_plan("books")],
        )
    ]


class TestEscalationRetry:
    @pytest.mark.asyncio
    async def test_retry_recovers_missing_handler_no_stub_no_raise(self):
        import importlib

        gen = importlib.import_module(_GEN_MOD)
        fake = _FakeAgentRun()
        save_stub = AsyncMock()
        captured: list = []
        beta = _make_handler_input("beta")
        side = [
            (["handler_code:alpha.tsx", "handler_code:gamma.tsx"], [beta]),
            (["handler_code:alpha.tsx", "handler_code:gamma.tsx", "handler_code:beta.tsx"], []),
        ]
        with (
            patch.object(gen, "BACKEND_HANDLER_ESCALATION_RETRY", True),
            patch.object(gen, "BACKEND_HANDLER_STUB_FALLBACK", True),
        ):
            for p in _patches(gen, fake, side, save_stub, captured):
                p.start()
            try:
                await _run(gen, _make_ctx(), ["alpha", "beta", "gamma"])
            finally:
                patch.stopall()
        assert fake.calls == 4  # 3 main + 1 retry (beta only)
        save_stub.assert_not_awaited()
        assert captured[-1]["status"] == "success"

    @pytest.mark.asyncio
    async def test_retry_disabled_skips_retry_and_stubs(self):
        import importlib

        gen = importlib.import_module(_GEN_MOD)
        fake = _FakeAgentRun()
        save_stub = AsyncMock()
        captured: list = []
        beta = _make_handler_input("beta")
        side = [(["handler_code:alpha.tsx", "handler_code:gamma.tsx"], [beta])]
        with (
            patch.object(gen, "BACKEND_HANDLER_ESCALATION_RETRY", False),
            patch.object(gen, "BACKEND_HANDLER_STUB_FALLBACK", True),
        ):
            for p in _patches(gen, fake, side, save_stub, captured):
                p.start()
            try:
                await _run(gen, _make_ctx(), ["alpha", "beta", "gamma"])
            finally:
                patch.stopall()
        assert fake.calls == 3  # no retry
        save_stub.assert_awaited_once()
        assert save_stub.await_args.args[1] == "beta"


class TestStubFallback:
    @pytest.mark.asyncio
    async def test_retry_fails_then_stub_continues_no_raise(self):
        import importlib

        gen = importlib.import_module(_GEN_MOD)
        fake = _FakeAgentRun()
        save_stub = AsyncMock()
        captured: list = []
        beta = _make_handler_input("beta")
        side = [
            (["handler_code:alpha.tsx"], [beta]),
            (["handler_code:alpha.tsx"], [beta]),  # still missing after retry
        ]
        with (
            patch.object(gen, "BACKEND_HANDLER_ESCALATION_RETRY", True),
            patch.object(gen, "BACKEND_HANDLER_STUB_FALLBACK", True),
        ):
            for p in _patches(gen, fake, side, save_stub, captured):
                p.start()
            try:
                await _run(gen, _make_ctx(), ["alpha", "beta"])
            finally:
                patch.stopall()
        save_stub.assert_awaited_once()
        assert save_stub.await_args.args[1] == "beta"
        assert captured[-1]["status"] == "partial"
        assert captured[-1]["stubbed"] == ["beta"]

    @pytest.mark.asyncio
    async def test_retry_fails_stub_off_raises_builder_error(self):
        import importlib

        from main_agent.errors import BuilderError

        gen = importlib.import_module(_GEN_MOD)
        fake = _FakeAgentRun()
        save_stub = AsyncMock()
        captured: list = []
        beta = _make_handler_input("beta")
        side = [
            (["handler_code:alpha.tsx"], [beta]),
            (["handler_code:alpha.tsx"], [beta]),
        ]
        with (
            patch.object(gen, "BACKEND_HANDLER_ESCALATION_RETRY", True),
            patch.object(gen, "BACKEND_HANDLER_STUB_FALLBACK", False),
        ):
            for p in _patches(gen, fake, side, save_stub, captured):
                p.start()
            try:
                with pytest.raises(BuilderError):
                    await _run(gen, _make_ctx(), ["alpha", "beta"])
            finally:
                patch.stopall()
        save_stub.assert_not_awaited()
