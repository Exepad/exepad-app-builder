"""Tests for the per-handler dispatch loop in ``generate_handler_code_artifacts``.

Item 0 of the 1ybz1p4n fix plan: BackendHandlerBuilder is dispatched
ONCE PER HANDLER with a singular ``BackendHandlerBuilderInput``. A
batched LLM-driven loop variant (commits af553249→cd07d957 on
2026-04-02) was reverted on 2026-05-19 after Pro started bailing
mid-batch on a 5-handler app.

These tests pin the loop invariants:
- Agent is invoked exactly once per planned handler.
- Each invocation receives a SINGULAR input (no ``handlers`` wrapper).
- An exception in one invocation does not abort the rest.
- Per-handler save-tool counter is reset before each invocation.
"""

from __future__ import annotations

import json
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


def _make_handler_plan(name: str):
    """Build a minimal HandlerPlan."""
    from main_agent.agents.orchestrator.app_types.shared.models.plan_models import (
        HandlerPlan,
    )

    return HandlerPlan(
        name=name,
        inputs=["x: text"],
        outputs=["ok: boolean"],
    )


def _make_handler_input(name: str):
    """Build a minimal BackendHandlerBuilderInput (the shape
    ``_check_saved_artifacts`` returns in its ``missing`` list)."""
    from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_handler_builder import (  # noqa: E501
        BackendHandlerBuilderInput,
    )

    return BackendHandlerBuilderInput(
        handler_plan=_make_handler_plan(name),
        model_plans=[],
        output_artifact_name=name,
    )


def _make_model_plan(name: str):
    """Build a minimal ModelPlan."""
    from main_agent.agents.orchestrator.app_types.shared.models.plan_models import (
        ColumnPlan,
        ModelPlan,
    )

    return ModelPlan(
        name=name,
        columns=[ColumnPlan(name="title", type="text")],
    )


def _make_ctx() -> MagicMock:
    """Minimal InvocationContext stub with session.state dict."""
    ctx = MagicMock()
    ctx.session = MagicMock()
    ctx.session.state = {}
    return ctx


class _FakeAgentRun:
    """Records every invocation of ``backend_handler_builder_agent.run_async``
    and yields a fixed number of mock events per call.

    Also captures the most recent JSON payload pushed to the agent so the
    test can assert it's shaped like ``BackendHandlerBuilderInput`` (NOT
    a batch envelope).
    """

    def __init__(self, *, events_per_call: int = 1, raise_on_call_idx: int | None = None):
        self.calls = 0
        self.events_per_call = events_per_call
        self.raise_on_call_idx = raise_on_call_idx

    def run_async(self, ctx) -> AsyncIterator:
        call_idx = self.calls
        self.calls += 1

        async def _gen():
            if self.raise_on_call_idx is not None and call_idx == self.raise_on_call_idx:
                raise RuntimeError(f"simulated handler {call_idx} failure")
            for _ in range(self.events_per_call):
                event = MagicMock()
                event.usage_metadata = None
                yield event

        return _gen()


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


class TestPerHandlerLoopDispatch:
    """The per-handler loop must invoke the agent exactly N times with one
    singular input per call."""

    @pytest.mark.asyncio
    async def test_agent_invoked_once_per_handler(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=2)
        pushed_payloads: list[str] = []

        async def fake_push(_ctx, prompt: str) -> None:
            pushed_payloads.append(prompt)

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(side_effect=fake_push),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(return_value=([], [])),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            ctx = _make_ctx()
            events = [
                e
                async for e in handler_code_generator.generate_handler_code_artifacts(
                    ctx,
                    handler_plans=[
                        _make_handler_plan("alpha"),
                        _make_handler_plan("beta"),
                        _make_handler_plan("gamma"),
                    ],
                    model_plans=[_make_model_plan("books")],
                )
            ]

        # One LLM invocation per handler — 3 total.
        assert fake_agent.calls == 3, f"expected 3 agent invocations, got {fake_agent.calls}"
        # 2 events per call × 3 calls = 6 yielded events.
        assert len(events) == 6
        # 3 prompts pushed, one per handler.
        assert len(pushed_payloads) == 3

    @pytest.mark.asyncio
    async def test_each_invocation_receives_singular_input_not_a_batch(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)
        pushed_payloads: list[str] = []

        async def fake_push(_ctx, prompt: str) -> None:
            pushed_payloads.append(prompt)

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(side_effect=fake_push),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(return_value=([], [])),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            ctx = _make_ctx()
            async for _ in handler_code_generator.generate_handler_code_artifacts(
                ctx,
                handler_plans=[
                    _make_handler_plan("alpha"),
                    _make_handler_plan("beta"),
                ],
                model_plans=[_make_model_plan("books")],
            ):
                pass

        assert len(pushed_payloads) == 2
        for raw in pushed_payloads:
            parsed = json.loads(raw)
            # SINGULAR shape — `handler_plan` is a top-level field.
            assert (
                "handler_plan" in parsed
            ), f"expected singular input, got batch-shaped payload: {parsed!r}"
            assert "output_artifact_name" in parsed
            # NOT batch-shaped — there is no top-level `handlers` array.
            assert (
                "handlers" not in parsed
            ), f"unexpected batch-wrapper: payload had top-level `handlers`: {parsed!r}"

        # Each push targets exactly one handler.
        names = [json.loads(p)["output_artifact_name"] for p in pushed_payloads]
        assert names == ["alpha", "beta"]

    @pytest.mark.asyncio
    async def test_exception_in_one_handler_does_not_abort_the_rest(self):
        """1ybz1p4n's failure mode was 'one handler dies mid-loop and the
        whole batch is lost'. The per-handler loop must keep going."""
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        # Second invocation (index 1) raises.
        fake_agent = _FakeAgentRun(events_per_call=1, raise_on_call_idx=1)

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(return_value=([], [])),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            ctx = _make_ctx()
            async for _ in handler_code_generator.generate_handler_code_artifacts(
                ctx,
                handler_plans=[
                    _make_handler_plan("alpha"),
                    _make_handler_plan("beta"),  # this one raises
                    _make_handler_plan("gamma"),
                ],
                model_plans=[_make_model_plan("books")],
            ):
                pass

        # All 3 invocations attempted — beta raised, but alpha + gamma still ran.
        assert fake_agent.calls == 3

    @pytest.mark.asyncio
    async def test_per_handler_save_tool_counter_reset_before_each_invocation(self):
        """The per-handler ``_save_tool_calls:<handler_name>`` counter must
        be reset to 0 before each invocation so the cap in
        ``backend_handler_builder.py`` applies per handler, not cumulatively."""
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        # Track counter state at the moment each push happens.
        observed_counters: list[int | None] = []

        async def fake_push(ctx, _prompt: str) -> None:
            # Read the counter for the handler whose payload was just pushed.
            payload = json.loads(_prompt)
            handler_name = payload["output_artifact_name"]
            observed_counters.append(ctx.session.state.get(f"_save_tool_calls:{handler_name}"))

        fake_agent = _FakeAgentRun(events_per_call=1)
        ctx = _make_ctx()
        # Pre-seed stale counter values to confirm the loop resets them.
        ctx.session.state["_save_tool_calls:alpha"] = 99
        ctx.session.state["_save_tool_calls:beta"] = 42

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(side_effect=fake_push),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(return_value=([], [])),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            async for _ in handler_code_generator.generate_handler_code_artifacts(
                ctx,
                handler_plans=[
                    _make_handler_plan("alpha"),
                    _make_handler_plan("beta"),
                ],
                model_plans=[_make_model_plan("books")],
            ):
                pass

        # Both invocations must observe a freshly-reset counter (0), not
        # the pre-seeded stale values (99, 42).
        assert observed_counters == [0, 0]

    @pytest.mark.asyncio
    async def test_empty_handler_list_skips_dispatch_entirely(self):
        """No agent invocation when there are no handlers to build."""
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun()

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(),
            ),
        ):
            ctx = _make_ctx()
            events = [
                e
                async for e in handler_code_generator.generate_handler_code_artifacts(
                    ctx,
                    handler_plans=[],
                    model_plans=[_make_model_plan("books")],
                )
            ]

        assert fake_agent.calls == 0
        assert events == []


class TestFailFastOnMissingArtifacts:
    """Item 1 of the 1ybz1p4n fix plan: when any handler artifact is
    missing after the dispatch loop, ``generate_handler_code_artifacts``
    must raise ``BuilderError(severity=FATAL)`` so the workflow aborts
    instead of proceeding to ComponentBuilder with a doomed config."""

    @pytest.mark.asyncio
    async def test_raises_when_no_handlers_produced(self):
        """1ybz1p4n's exact failure shape: 0/5 handlers saved."""
        from main_agent.errors import BuilderError, ErrorSeverity
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            # Strict-abort mode: the fail-fast raise is now gated behind the
            # stub-fallback flag (default true ships a stub instead). This test
            # pins the raise path, so disable stubbing.
            patch.object(handler_code_generator, "BACKEND_HANDLER_STUB_FALLBACK", False),
            patch.object(
                # Simulate the real failure mode: agent yielded events but
                # no artifacts ended up saved (the LLM never called the
                # save tool, or called it but the validator rejected every
                # attempt).
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(
                    return_value=(
                        [],
                        [
                            _make_handler_input(n)
                            for n in ("alpha", "beta", "gamma", "delta", "epsilon")
                        ],
                    )
                ),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            ctx = _make_ctx()
            with pytest.raises(BuilderError) as exc_info:
                async for _ in handler_code_generator.generate_handler_code_artifacts(
                    ctx,
                    handler_plans=[
                        _make_handler_plan(n)
                        for n in ("alpha", "beta", "gamma", "delta", "epsilon")
                    ],
                    model_plans=[_make_model_plan("books")],
                ):
                    pass

            err = exc_info.value
            assert err.severity == ErrorSeverity.FATAL
            assert err.builder_name == "BackendHandlerBuilder"
            # The exception carries enough context for the caller / logs
            # to identify which handlers failed.
            assert "missing" in err.context
            assert set(err.context["missing"]) == {"alpha", "beta", "gamma", "delta", "epsilon"}
            assert err.context["total_requested"] == 5
            assert err.context["built"] == []

    @pytest.mark.asyncio
    async def test_raises_on_partial_failure(self):
        """If even ONE handler is missing, we still abort. A partial
        backend ships an app where some pages render and some 404."""
        from main_agent.errors import BuilderError, ErrorSeverity
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            # Strict-abort mode (stub fallback off) to pin the raise path.
            patch.object(handler_code_generator, "BACKEND_HANDLER_STUB_FALLBACK", False),
            patch.object(
                # 2 saved, 1 missing.
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(
                    return_value=(
                        ["handler_code:alpha.tsx", "handler_code:beta.tsx"],
                        [_make_handler_input("gamma")],
                    )
                ),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            ctx = _make_ctx()
            with pytest.raises(BuilderError) as exc_info:
                async for _ in handler_code_generator.generate_handler_code_artifacts(
                    ctx,
                    handler_plans=[
                        _make_handler_plan("alpha"),
                        _make_handler_plan("beta"),
                        _make_handler_plan("gamma"),
                    ],
                    model_plans=[_make_model_plan("books")],
                ):
                    pass

            err = exc_info.value
            assert err.severity == ErrorSeverity.FATAL
            assert err.context["missing"] == ["gamma"]
            assert set(err.context["built"]) == {"alpha", "beta"}
            assert err.context["total_requested"] == 3

    @pytest.mark.asyncio
    async def test_no_raise_on_full_success(self):
        """Happy path — all artifacts present, no exception."""
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(
                    return_value=(
                        ["handler_code:alpha.tsx", "handler_code:beta.tsx"],
                        [],
                    )
                ),
            ),
            patch.object(
                handler_code_generator,
                "MetricsTracker",
                MagicMock(
                    return_value=MagicMock(
                        start_agent=AsyncMock(),
                        record_tokens=AsyncMock(),
                        stop_agent=AsyncMock(return_value=None),
                    )
                ),
            ),
        ):
            ctx = _make_ctx()
            # Should not raise.
            async for _ in handler_code_generator.generate_handler_code_artifacts(
                ctx,
                handler_plans=[
                    _make_handler_plan("alpha"),
                    _make_handler_plan("beta"),
                ],
                model_plans=[_make_model_plan("books")],
            ):
                pass


class TestAgentIoPersistence:
    """Item 2 of the 1ybz1p4n fix plan: BackendBuilder must persist
    ``agent_io:BackendBuilder:input.json`` and ``:output.json`` so that
    when an LLM goes anemic (22 candidate tokens, 0 tool calls) we can
    post-mortem the actual response shape. Other agents already persist
    via ``base_workflow._run_agent_with_metrics``; BackendBuilder
    bypasses that wrapper so it must persist explicitly."""

    @pytest.mark.asyncio
    async def test_input_snapshot_saved_with_all_handler_tasks(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)
        save_calls: list[tuple[str, str, object]] = []

        async def fake_save(ctx, agent_name, io_type, data):
            save_calls.append((agent_name, io_type, data))

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(
                    return_value=(
                        ["handler_code:alpha.tsx", "handler_code:beta.tsx"],
                        [],
                    )
                ),
            ),
            patch.object(
                handler_code_generator,
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
                handler_code_generator.ArtifactManager,
                "save_agent_io_artifact",
                AsyncMock(side_effect=fake_save),
            ),
        ):
            ctx = _make_ctx()
            async for _ in handler_code_generator.generate_handler_code_artifacts(
                ctx,
                handler_plans=[
                    _make_handler_plan("alpha"),
                    _make_handler_plan("beta"),
                ],
                model_plans=[_make_model_plan("books")],
            ):
                pass

        # Exactly one input snapshot + one output snapshot.
        input_saves = [c for c in save_calls if c[1] == "input"]
        output_saves = [c for c in save_calls if c[1] == "output"]
        assert len(input_saves) == 1, f"expected 1 input snapshot, got {len(input_saves)}"
        assert len(output_saves) == 1, f"expected 1 output snapshot, got {len(output_saves)}"

        # Input snapshot carries all handler tasks.
        agent_name, _io_type, data = input_saves[0]
        assert agent_name == "BackendBuilder"
        assert data["total_requested"] == 2
        assert len(data["handlers"]) == 2
        assert {h["output_artifact_name"] for h in data["handlers"]} == {"alpha", "beta"}

    @pytest.mark.asyncio
    async def test_output_snapshot_records_success_status(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)
        save_calls: list[tuple[str, str, object]] = []

        async def fake_save(ctx, agent_name, io_type, data):
            save_calls.append((agent_name, io_type, data))

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(
                    return_value=(
                        ["handler_code:alpha.tsx", "handler_code:beta.tsx"],
                        [],
                    )
                ),
            ),
            patch.object(
                handler_code_generator,
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
                handler_code_generator.ArtifactManager,
                "save_agent_io_artifact",
                AsyncMock(side_effect=fake_save),
            ),
        ):
            ctx = _make_ctx()
            async for _ in handler_code_generator.generate_handler_code_artifacts(
                ctx,
                handler_plans=[
                    _make_handler_plan("alpha"),
                    _make_handler_plan("beta"),
                ],
                model_plans=[_make_model_plan("books")],
            ):
                pass

        output_data = [c for c in save_calls if c[1] == "output"][0][2]
        assert output_data["status"] == "success"
        assert set(output_data["handlers_built"]) == {"alpha", "beta"}
        assert output_data["missing"] == []
        assert output_data["total_requested"] == 2

    @pytest.mark.asyncio
    async def test_output_snapshot_persisted_when_fail_fast_raises(self):
        """The exact 1ybz1p4n diagnostic scenario: 0/5 handlers saved
        means BuilderError raises, but the output snapshot must STILL be
        persisted (in the finally block) so post-mortem can read it."""
        from main_agent.errors import BuilderError
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            handler_code_generator,
        )

        fake_agent = _FakeAgentRun(events_per_call=1)
        save_calls: list[tuple[str, str, object]] = []

        async def fake_save(ctx, agent_name, io_type, data):
            save_calls.append((agent_name, io_type, data))

        with (
            patch.object(
                handler_code_generator,
                "backend_handler_builder_agent",
                MagicMock(run_async=fake_agent.run_async),
            ),
            patch.object(
                handler_code_generator,
                "push_prompt_to_next_agent",
                AsyncMock(),
            ),
            # Strict-abort mode (stub fallback off) to pin the raise path.
            patch.object(handler_code_generator, "BACKEND_HANDLER_STUB_FALLBACK", False),
            patch.object(
                handler_code_generator,
                "_check_saved_artifacts",
                AsyncMock(
                    return_value=(
                        [],
                        [
                            _make_handler_input(n)
                            for n in ("alpha", "beta", "gamma", "delta", "epsilon")
                        ],
                    )
                ),
            ),
            patch.object(
                handler_code_generator,
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
                handler_code_generator.ArtifactManager,
                "save_agent_io_artifact",
                AsyncMock(side_effect=fake_save),
            ),
        ):
            ctx = _make_ctx()
            with pytest.raises(BuilderError):
                async for _ in handler_code_generator.generate_handler_code_artifacts(
                    ctx,
                    handler_plans=[
                        _make_handler_plan(n)
                        for n in ("alpha", "beta", "gamma", "delta", "epsilon")
                    ],
                    model_plans=[_make_model_plan("books")],
                ):
                    pass

        # Both snapshots persisted EVEN THOUGH the function raised.
        input_saves = [c for c in save_calls if c[1] == "input"]
        output_saves = [c for c in save_calls if c[1] == "output"]
        assert len(input_saves) == 1
        assert len(output_saves) == 1

        # Output records the failure state with the full missing list.
        output_data = output_saves[0][2]
        assert output_data["status"] == "failed"
        assert output_data["handlers_built"] == []
        assert set(output_data["missing"]) == {"alpha", "beta", "gamma", "delta", "epsilon"}


class TestBatchHandlerBuilderInputRemoved:
    """Regression guard — the batch wrapper class must stay deleted so we
    can't accidentally regress to the failing 2026-04-02 design."""

    def test_class_not_importable_from_module(self):
        from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders import (
            backend_handler_builder,
        )

        assert not hasattr(backend_handler_builder, "BatchHandlerBuilderInput"), (
            "BatchHandlerBuilderInput re-introduced. The handler builder dispatch "
            "must stay one-handler-per-invocation; the batch wrapper caused 1ybz1p4n."
        )

    def test_class_not_in_package_exports(self):
        from main_agent.agents.orchestrator.app_types.shared.builders import backend_builders

        assert "BatchHandlerBuilderInput" not in getattr(backend_builders, "__all__", [])
        assert not hasattr(backend_builders, "BatchHandlerBuilderInput")
