"""Unit tests for parallel pre-build agent cloning and runner."""

import json
from unittest.mock import MagicMock, patch

import pytest
from google.adk.agents import LlmAgent

from main_agent.agents.orchestrator.app_types.webapp.workflows.parallel_pre_build import (
    create_pre_build_clone,
    run_pre_build_parallel,
    PRE_BUILD_DS_INPUT_KEY,
    PRE_BUILD_LOGIC_INPUT_KEY,
    PRE_BUILD_BACKEND_INPUT_KEY,
)
from main_agent.errors import PipelineError


@pytest.fixture
def mock_agent():
    """Create a minimal mock LlmAgent for cloning tests."""
    agent = MagicMock(spec=LlmAgent)
    agent.name = "TestAgent"
    agent.model = "gemini-3-flash-preview"
    agent.description = "Test agent"
    agent.instruction = "Base instruction text"
    agent.tools = []
    agent.planner = None
    return agent


@pytest.fixture
def mock_agent_with_callable_instruction():
    """Create a mock LlmAgent whose instruction is a callable provider."""
    agent = MagicMock(spec=LlmAgent)
    agent.name = "CallableAgent"
    agent.model = "gemini-3-flash-preview"
    agent.description = "Agent with callable instruction"
    agent.instruction = lambda ctx: "Resolved base instruction"
    agent.tools = []
    agent.planner = None
    return agent


class TestCreatePreBuildClone:
    def test_clone_has_correct_name(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        assert clone.name == "TestAgent_ds"

    def test_clone_has_no_input_schema(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        assert clone.input_schema is None

    def test_clone_has_unique_output_key(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        assert clone.output_key == "pre_build_result_ds"

    def test_clone_preserves_model(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        assert clone.model == "gemini-3-flash-preview"

    def test_clone_preserves_tools(self, mock_agent):
        def tool_a():
            pass

        def tool_b():
            pass

        mock_agent.tools = [tool_a, tool_b]
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        assert clone.tools == [tool_a, tool_b]

    def test_clone_instruction_includes_base_text(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        instruction = clone.instruction(None)
        assert "Base instruction text" in instruction

    def test_clone_instruction_reads_state_key(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")

        mock_ctx = MagicMock()
        test_input = json.dumps({"primary_color": "#835400"})
        mock_ctx.state = {PRE_BUILD_DS_INPUT_KEY: test_input}

        instruction = clone.instruction(mock_ctx)
        assert "#835400" in instruction
        assert "YOUR INPUT" in instruction

    def test_clone_instruction_handles_none_context(self, mock_agent):
        clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        instruction = clone.instruction(None)
        assert "Base instruction text" in instruction

    def test_clone_resolves_callable_instruction(self, mock_agent_with_callable_instruction):
        clone = create_pre_build_clone(
            mock_agent_with_callable_instruction,
            PRE_BUILD_LOGIC_INPUT_KEY,
            "logic",
        )
        instruction = clone.instruction(None)
        assert "Resolved base instruction" in instruction

    def test_different_labels_produce_different_clones(self, mock_agent):
        ds_clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        logic_clone = create_pre_build_clone(mock_agent, PRE_BUILD_LOGIC_INPUT_KEY, "logic")
        backend_clone = create_pre_build_clone(mock_agent, PRE_BUILD_BACKEND_INPUT_KEY, "backend")

        assert ds_clone.name != logic_clone.name != backend_clone.name
        assert ds_clone.output_key != logic_clone.output_key != backend_clone.output_key

    def test_each_clone_reads_its_own_state_key(self, mock_agent):
        ds_clone = create_pre_build_clone(mock_agent, PRE_BUILD_DS_INPUT_KEY, "ds")
        logic_clone = create_pre_build_clone(mock_agent, PRE_BUILD_LOGIC_INPUT_KEY, "logic")

        mock_ctx = MagicMock()
        mock_ctx.state = {
            PRE_BUILD_DS_INPUT_KEY: '{"type": "ds"}',
            PRE_BUILD_LOGIC_INPUT_KEY: '{"type": "logic"}',
        }

        ds_instruction = ds_clone.instruction(mock_ctx)
        logic_instruction = logic_clone.instruction(mock_ctx)

        assert '"type": "ds"' in ds_instruction
        assert '"type": "logic"' not in ds_instruction
        assert '"type": "logic"' in logic_instruction
        assert '"type": "ds"' not in logic_instruction


class TestConfigFlags:
    def test_parallel_pre_build_flag_exists(self):
        from config import PARALLEL_PRE_BUILD

        assert isinstance(PARALLEL_PRE_BUILD, bool)

    def test_parallel_post_build_flag_exists(self):
        from config import PARALLEL_POST_BUILD

        assert isinstance(PARALLEL_POST_BUILD, bool)

    def test_parallel_initial_builders_timeout_exists(self):
        from config import PARALLEL_INITIAL_BUILDERS_TIMEOUT

        assert isinstance(PARALLEL_INITIAL_BUILDERS_TIMEOUT, float)
        assert PARALLEL_INITIAL_BUILDERS_TIMEOUT > 0


class TestRunPreBuildParallelTimeout:
    """Test that TimeoutError from TimeoutParallelAgent is caught and re-raised as PipelineError."""

    @pytest.mark.asyncio
    async def test_timeout_raises_pipeline_error(self, mock_agent):
        """When TimeoutParallelAgent times out, run_pre_build_parallel raises PipelineError."""
        mock_ctx = MagicMock()
        mock_ctx.session.state = {}

        async def _timeout_impl(*args, **kwargs):
            raise TimeoutError("agents took too long")
            yield  # make it an async generator  # noqa: E501

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.parallel_pre_build.TimeoutParallelAgent"
        ) as mock_parallel_cls:
            instance = mock_parallel_cls.return_value
            instance._run_async_impl = _timeout_impl

            with pytest.raises(PipelineError, match="timed out"):
                async for _ in run_pre_build_parallel(
                    ctx=mock_ctx,
                    ds_agent=mock_agent,
                    ds_input_json='{"test": true}',
                    logic_agent=None,
                    logic_input_json=None,
                    backend_agent=None,
                    backend_input_json=None,
                ):
                    pass

    @pytest.mark.asyncio
    async def test_timeout_error_wraps_original(self, mock_agent):
        """The PipelineError should chain the original TimeoutError."""
        mock_ctx = MagicMock()
        mock_ctx.session.state = {}

        original_error = TimeoutError("original timeout")

        async def _timeout_impl(*args, **kwargs):
            raise original_error
            yield  # noqa: E501

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.parallel_pre_build.TimeoutParallelAgent"
        ) as mock_parallel_cls:
            instance = mock_parallel_cls.return_value
            instance._run_async_impl = _timeout_impl

            with pytest.raises(PipelineError) as exc_info:
                async for _ in run_pre_build_parallel(
                    ctx=mock_ctx,
                    ds_agent=mock_agent,
                    ds_input_json='{"test": true}',
                    logic_agent=None,
                    logic_input_json=None,
                    backend_agent=None,
                    backend_input_json=None,
                ):
                    pass

            assert exc_info.value.__cause__ is original_error
            assert exc_info.value.step_name == "ParallelPreBuild"
