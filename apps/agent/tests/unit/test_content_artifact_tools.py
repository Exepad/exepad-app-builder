"""Unit tests for content artifact tools.

Tests cover:
- save_content_artifact function validation
- Artifact naming format
- Error handling
"""

from unittest.mock import AsyncMock, MagicMock
import pytest

# Mark all tests in this module as unit tests
pytestmark = pytest.mark.unit


# =============================================================================
# SAVE CONTENT ARTIFACT TESTS
# =============================================================================


class TestSaveContentArtifact:
    """Tests for save_content_artifact function."""

    @pytest.fixture
    def mock_tool_context(self):
        """Create mock tool context with artifact service."""
        ctx = MagicMock()
        ctx.save_artifact = AsyncMock(return_value=1)  # Returns version 1
        return ctx

    @pytest.mark.asyncio
    async def test_valid_save_with_page_component_format(self, mock_tool_context):
        """Valid save with page:component format should succeed."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="home:hero",
            content_md="# Hero Section\n\nWelcome to our website.",
        )

        assert result["success"] is True
        assert result["artifact_filename"] == "content:home:hero.md"
        assert result["version"] == 1
        mock_tool_context.save_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_invalid_format_missing_colon(self, mock_tool_context):
        """Invalid format (missing colon) should return error."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="invalid_name_no_colon",
            content_md="# Content",
        )

        assert result["success"] is False
        assert "Invalid artifact_name format" in result["error"]
        mock_tool_context.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_artifact_name(self, mock_tool_context):
        """Empty artifact name should return error."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="",
            content_md="# Content",
        )

        assert result["success"] is False
        assert "Invalid artifact_name format" in result["error"]

    @pytest.mark.asyncio
    async def test_empty_content(self, mock_tool_context):
        """Empty content should return error."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="home:hero",
            content_md="",
        )

        assert result["success"] is False
        assert "Content cannot be empty" in result["error"]
        mock_tool_context.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_whitespace_only_content(self, mock_tool_context):
        """Whitespace-only content should return error."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="home:hero",
            content_md="   \n\t  \n  ",
        )

        assert result["success"] is False
        assert "Content cannot be empty" in result["error"]
        mock_tool_context.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_correct_artifact_key_format(self, mock_tool_context):
        """Artifact key should follow content:page:component.md format."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="about:story",
            content_md="# About Story\n\nOur company history...",
        )

        assert result["artifact_filename"] == "content:about:story.md"

    @pytest.mark.asyncio
    async def test_returns_summary(self, mock_tool_context):
        """Result should include summary with content length."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        content = "# Test Content\n\nThis is some test content."
        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="test:content",
            content_md=content,
        )

        assert "summary" in result
        assert str(len(content)) in result["summary"]

    @pytest.mark.asyncio
    async def test_returns_version(self, mock_tool_context):
        """Result should include version from artifact service."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        mock_tool_context.save_artifact = AsyncMock(return_value=5)  # Version 5

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="test:content",
            content_md="# Test",
        )

        assert result["version"] == 5

    @pytest.mark.asyncio
    async def test_handles_save_error(self, mock_tool_context):
        """Artifact save error should be handled gracefully."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        mock_tool_context.save_artifact = AsyncMock(side_effect=Exception("Storage error"))

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="test:content",
            content_md="# Test Content",
        )

        assert result["success"] is False
        assert "Storage error" in result["error"]

    @pytest.mark.asyncio
    async def test_complex_artifact_name(self, mock_tool_context):
        """Complex artifact name with multiple parts should work."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="services:web-development",
            content_md="# Web Development Services\n\nWe build websites.",
        )

        assert result["success"] is True
        assert result["artifact_filename"] == "content:services:web-development.md"

    @pytest.mark.asyncio
    async def test_unicode_content(self, mock_tool_context):
        """Unicode content should be handled correctly."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact

        content = "# 日本語タイトル\n\nこれはテストコンテンツです。"
        result = await save_content_artifact(
            tool_context=mock_tool_context,
            artifact_name="page:section",
            content_md=content,
        )

        assert result["success"] is True
        assert "summary" in result


# =============================================================================
# FUNCTION TOOL TESTS
# =============================================================================


class TestSaveContentArtifactTool:
    """Tests for the FunctionTool wrapper."""

    def test_tool_instance_exists(self):
        """save_content_artifact_tool should be importable."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact_tool

        assert save_content_artifact_tool is not None

    def test_tool_is_function_tool(self):
        """save_content_artifact_tool should be a FunctionTool."""
        from main_agent.agents.tools.content_artifact_tools import save_content_artifact_tool
        from google.adk.tools import FunctionTool

        assert isinstance(save_content_artifact_tool, FunctionTool)


# =============================================================================
# SAVE PLAN ARTIFACT TESTS
# =============================================================================


class TestSavePlanArtifact:
    """Tests for save_plan_artifact — the building-plan escalation tool used
    by Creator to keep its structured output under Gemini 3's max_output_tokens
    cap on game-class apps with verbose building plans."""

    @pytest.fixture
    def mock_tool_context(self):
        ctx = MagicMock()
        ctx.save_artifact = AsyncMock(return_value=1)
        return ctx

    @pytest.mark.asyncio
    async def test_valid_per_component_save(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="HomeContent",
            plan_md="- Hero with CTA\n- Three-up feature grid\n- Testimonial carousel",
        )

        assert result["success"] is True
        assert result["artifact_filename"] == "plan:HomeContent.md"
        assert result["version"] == 1
        mock_tool_context.save_artifact.assert_called_once()

    @pytest.mark.asyncio
    async def test_app_wide_save(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="app",
            plan_md="- Mario-style platformer\n- 3 levels\n- High-score leaderboard",
        )

        assert result["success"] is True
        assert result["artifact_filename"] == "plan:app.md"

    @pytest.mark.asyncio
    async def test_rejects_artifact_name_with_colon(self, mock_tool_context):
        """Colon in artifact_name is forbidden — the tool adds the 'plan:'
        prefix automatically and would produce 'plan:foo:bar.md' otherwise."""
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="foo:bar",
            plan_md="- bullet",
        )

        assert result["success"] is False
        assert "must not contain" in result["error"]
        mock_tool_context.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_rejects_empty_artifact_name(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="",
            plan_md="- bullet",
        )

        assert result["success"] is False
        assert "cannot be empty" in result["error"]
        mock_tool_context.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_rejects_whitespace_only_artifact_name(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="   \t  ",
            plan_md="- bullet",
        )

        assert result["success"] is False
        assert "cannot be empty" in result["error"]

    @pytest.mark.asyncio
    async def test_rejects_empty_plan_md(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="HomeContent",
            plan_md="",
        )

        assert result["success"] is False
        assert "cannot be empty" in result["error"]
        mock_tool_context.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_rejects_whitespace_only_plan_md(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="HomeContent",
            plan_md="\n\n\t   \n",
        )

        assert result["success"] is False
        assert "cannot be empty" in result["error"]

    @pytest.mark.asyncio
    async def test_returns_summary_with_char_count(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        plan = "- bullet 1\n- bullet 2\n- bullet 3"
        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="HomeContent",
            plan_md=plan,
        )

        assert "summary" in result
        assert str(len(plan)) in result["summary"]

    @pytest.mark.asyncio
    async def test_handles_save_service_error(self, mock_tool_context):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        mock_tool_context.save_artifact = AsyncMock(side_effect=Exception("R2 unreachable"))

        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="HomeContent",
            plan_md="- bullet",
        )

        assert result["success"] is False
        assert "R2 unreachable" in result["error"]

    @pytest.mark.asyncio
    async def test_unicode_plan_content(self, mock_tool_context):
        """Unicode bullets must round-trip cleanly through the artifact
        store — Creator generates plans in the user's language."""
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact

        plan = "- レイアウト: ヒーロー画像\n- データ: 製品リスト"
        result = await save_plan_artifact(
            tool_context=mock_tool_context,
            artifact_name="HomeContent",
            plan_md=plan,
        )

        assert result["success"] is True
        assert result["artifact_filename"] == "plan:HomeContent.md"


class TestSavePlanArtifactTool:
    """Tests for the FunctionTool wrapper."""

    def test_tool_instance_exists(self):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact_tool

        assert save_plan_artifact_tool is not None

    def test_tool_is_function_tool(self):
        from main_agent.agents.tools.content_artifact_tools import save_plan_artifact_tool
        from google.adk.tools import FunctionTool

        assert isinstance(save_plan_artifact_tool, FunctionTool)
