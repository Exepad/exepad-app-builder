"""Unit tests for pricing service - cost calculation for Gemini API calls."""

from unittest.mock import MagicMock

import pytest


class TestPricingConstants:
    """Tests for pricing configuration constants."""

    @pytest.mark.unit
    def test_tier_threshold_is_200k(self):
        """Tier threshold should be 200,000 tokens."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            TIER_THRESHOLD,
        )

        assert TIER_THRESHOLD == 200_000

    @pytest.mark.unit
    def test_default_model_exists_in_pricing(self):
        """Default model should have pricing defined."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            DEFAULT_MODEL,
            GEMINI_PRICING,
        )

        assert DEFAULT_MODEL in GEMINI_PRICING


class TestCalculateGeminiCost:
    """Tests for the calculate_gemini_cost function."""

    def _create_mock_metadata(
        self,
        prompt_tokens: int = 0,
        candidates_tokens: int = 0,
        thoughts_tokens: int = 0,
        tool_use_tokens: int = 0,
        cached_tokens: int = 0,
    ):
        """Create a mock metadata object for testing."""
        metadata = MagicMock()
        metadata.prompt_token_count = prompt_tokens
        metadata.candidates_token_count = candidates_tokens
        metadata.thoughts_token_count = thoughts_tokens
        metadata.tool_use_prompt_token_count = tool_use_tokens
        metadata.cached_content_token_count = cached_tokens
        return metadata

    @pytest.mark.unit
    def test_calculate_cost_returns_float(self):
        """Cost calculation should return a float."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
        )

        metadata = self._create_mock_metadata(prompt_tokens=1000, candidates_tokens=500)
        cost = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        assert isinstance(cost, float)

    @pytest.mark.unit
    def test_calculate_cost_zero_tokens(self):
        """Zero tokens should result in zero cost."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
        )

        metadata = self._create_mock_metadata()
        cost = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        assert cost == 0.0

    @pytest.mark.unit
    def test_calculate_cost_tier1_flash(self):
        """Tier 1 pricing for flash model (flat rate, under 200k)."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            GEMINI_PRICING,
        )

        # 10k input, 5k output - well under tier threshold
        metadata = self._create_mock_metadata(prompt_tokens=10_000, candidates_tokens=5_000)
        cost = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        # Manual calculation for gemini-2.5-flash tier 1:
        # Input: 10k/1M * $0.30 = $0.003
        # Output: 5k/1M * $2.50 = $0.0125
        # Total: ~$0.0155
        pricing = GEMINI_PRICING["gemini-2.5-flash"]
        expected = (10_000 / 1_000_000) * pricing.input_tier1 + (
            5_000 / 1_000_000
        ) * pricing.output_tier1

        assert cost == pytest.approx(expected, rel=0.01)

    @pytest.mark.unit
    def test_calculate_cost_tier2_pro(self):
        """Tier 2 pricing kicks in above 200k tokens for pro models."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            GEMINI_PRICING,
        )

        # 250k input tokens - above tier threshold
        metadata = self._create_mock_metadata(prompt_tokens=250_000, candidates_tokens=10_000)
        cost = calculate_gemini_cost(metadata, "gemini-2.5-pro")

        # Should use tier 2 pricing
        pricing = GEMINI_PRICING["gemini-2.5-pro"]
        expected = (250_000 / 1_000_000) * pricing.input_tier2 + (
            10_000 / 1_000_000
        ) * pricing.output_tier2

        assert cost == pytest.approx(expected, rel=0.01)

    @pytest.mark.unit
    def test_calculate_cost_with_caching(self):
        """Cached tokens should use lower pricing rate."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            GEMINI_PRICING,
        )

        # 10k total input, 5k cached
        metadata = self._create_mock_metadata(
            prompt_tokens=10_000, candidates_tokens=1_000, cached_tokens=5_000
        )
        cost = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        pricing = GEMINI_PRICING["gemini-2.5-flash"]
        # 5k standard input + 5k cached input + 1k output
        standard_input = 5_000  # total - cached
        expected = (
            (standard_input / 1_000_000) * pricing.input_tier1
            + (5_000 / 1_000_000) * pricing.cached_tier1
            + (1_000 / 1_000_000) * pricing.output_tier1
        )

        assert cost == pytest.approx(expected, rel=0.01)

    @pytest.mark.unit
    def test_calculate_cost_includes_thoughts(self):
        """Thoughts tokens should be included in output cost."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            GEMINI_PRICING,
        )

        # Output includes both candidates and thoughts
        metadata = self._create_mock_metadata(
            prompt_tokens=1_000, candidates_tokens=500, thoughts_tokens=500
        )
        cost = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        pricing = GEMINI_PRICING["gemini-2.5-flash"]
        total_output = 500 + 500  # candidates + thoughts
        expected = (1_000 / 1_000_000) * pricing.input_tier1 + (
            total_output / 1_000_000
        ) * pricing.output_tier1

        assert cost == pytest.approx(expected, rel=0.01)

    @pytest.mark.unit
    def test_tool_use_tokens_not_double_counted(self):
        """Tool use tokens are a subset of prompt_token_count and must not be added separately."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            GEMINI_PRICING,
        )

        # prompt_token_count=1000 already includes the 200 tool_use tokens
        metadata = self._create_mock_metadata(
            prompt_tokens=1_000, candidates_tokens=500, tool_use_tokens=200
        )
        cost = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        pricing = GEMINI_PRICING["gemini-2.5-flash"]
        # Only prompt_token_count (1000) should be used as input, NOT 1000+200
        expected = (1_000 / 1_000_000) * pricing.input_tier1 + (
            500 / 1_000_000
        ) * pricing.output_tier1

        assert cost == pytest.approx(expected, rel=0.01)

    @pytest.mark.unit
    def test_unknown_model_uses_default(self):
        """Unknown model should fall back to default pricing."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            DEFAULT_MODEL,
        )

        metadata = self._create_mock_metadata(prompt_tokens=1_000, candidates_tokens=500)

        # Unknown model
        cost_unknown = calculate_gemini_cost(metadata, "unknown-model-xyz")

        # Same calculation with default model
        cost_default = calculate_gemini_cost(metadata, DEFAULT_MODEL)

        assert cost_unknown == cost_default

    @pytest.mark.unit
    def test_model_name_normalization(self):
        """Should handle model names with 'models/' prefix."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
        )

        metadata = self._create_mock_metadata(prompt_tokens=1_000, candidates_tokens=500)

        # With prefix
        cost_with_prefix = calculate_gemini_cost(metadata, "models/gemini-2.5-flash")
        # Without prefix
        cost_without_prefix = calculate_gemini_cost(metadata, "gemini-2.5-flash")

        assert cost_with_prefix == cost_without_prefix

    @pytest.mark.unit
    def test_none_model_uses_default(self):
        """None model should use default pricing."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_gemini_cost,
            DEFAULT_MODEL,
        )

        metadata = self._create_mock_metadata(prompt_tokens=1_000, candidates_tokens=500)

        cost_none = calculate_gemini_cost(metadata, None)
        cost_default = calculate_gemini_cost(metadata, DEFAULT_MODEL)

        assert cost_none == cost_default


class TestModelPricing:
    """Tests for ModelPricing structure."""

    @pytest.mark.unit
    def test_flash_models_have_no_tier2(self):
        """Flash models should have flat pricing (no tier 2)."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            GEMINI_PRICING,
        )

        flash_pricing = GEMINI_PRICING["gemini-2.5-flash"]
        assert flash_pricing.input_tier2 is None
        assert flash_pricing.output_tier2 is None

    @pytest.mark.unit
    def test_pro_models_have_tier2(self):
        """Pro models should have tier-based pricing."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            GEMINI_PRICING,
        )

        pro_pricing = GEMINI_PRICING["gemini-2.5-pro"]
        assert pro_pricing.input_tier2 is not None
        assert pro_pricing.output_tier2 is not None

    @pytest.mark.unit
    def test_cached_cheaper_than_standard(self):
        """Cached input should be cheaper than standard input."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            GEMINI_PRICING,
        )

        for model_name, pricing in GEMINI_PRICING.items():
            assert (
                pricing.cached_tier1 < pricing.input_tier1
            ), f"{model_name}: cached should be cheaper than input"


def _meta(
    prompt_tokens: int = 0,
    candidates_tokens: int = 0,
    thoughts_tokens: int = 0,
    cached_tokens: int = 0,
):
    """Mock usage metadata for OpenRouter/dispatcher tests."""
    m = MagicMock()
    m.prompt_token_count = prompt_tokens
    m.candidates_token_count = candidates_tokens
    m.thoughts_token_count = thoughts_tokens
    m.tool_use_prompt_token_count = 0
    m.cached_content_token_count = cached_tokens
    return m


class TestOpenRouterPricing:
    """Tests for non-Gemini (LiteLLM/OpenRouter) cost calculation."""

    @pytest.mark.unit
    def test_static_table_pricing(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            OPENROUTER_PRICING,
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        cost = calculate_openrouter_cost(meta, "deepseek/deepseek-chat")

        p = OPENROUTER_PRICING["deepseek/deepseek-chat"]
        expected = (10_000 / 1_000_000) * p.input + (5_000 / 1_000_000) * p.output
        assert cost == pytest.approx(expected)

    @pytest.mark.unit
    def test_openrouter_routing_prefix_stripped(self):
        """`openrouter/<vendor>/<model>` and the bare `<vendor>/<model>` match."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        with_prefix = calculate_openrouter_cost(meta, "openrouter/deepseek/deepseek-chat")
        without_prefix = calculate_openrouter_cost(meta, "deepseek/deepseek-chat")
        assert with_prefix == without_prefix

    @pytest.mark.unit
    def test_variant_suffix_falls_back_to_base(self):
        """`:free` / `:nitro` variants resolve to the base model's pricing."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        variant = calculate_openrouter_cost(meta, "deepseek/deepseek-chat:free")
        base = calculate_openrouter_cost(meta, "deepseek/deepseek-chat")
        assert variant == base

    @pytest.mark.unit
    def test_thoughts_billed_as_output(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            OPENROUTER_PRICING,
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=1_000, candidates_tokens=500, thoughts_tokens=500)
        cost = calculate_openrouter_cost(meta, "deepseek/deepseek-r1")

        p = OPENROUTER_PRICING["deepseek/deepseek-r1"]
        expected = (1_000 / 1_000_000) * p.input + ((500 + 500) / 1_000_000) * p.output
        assert cost == pytest.approx(expected)

    @pytest.mark.unit
    def test_cached_uses_cached_rate(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            OPENROUTER_PRICING,
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=1_000, cached_tokens=6_000)
        cost = calculate_openrouter_cost(meta, "deepseek/deepseek-chat")

        p = OPENROUTER_PRICING["deepseek/deepseek-chat"]
        expected = (
            (4_000 / 1_000_000) * p.input  # 10k - 6k cached
            + (6_000 / 1_000_000) * p.cached
            + (1_000 / 1_000_000) * p.output
        )
        assert cost == pytest.approx(expected)

    @pytest.mark.unit
    def test_unknown_model_uses_fallback(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            OPENROUTER_FALLBACK,
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        cost = calculate_openrouter_cost(meta, "acme/never-heard-of-it")

        expected = (10_000 / 1_000_000) * OPENROUTER_FALLBACK.input + (
            5_000 / 1_000_000
        ) * OPENROUTER_FALLBACK.output
        assert cost == pytest.approx(expected)

    @pytest.mark.unit
    def test_live_catalog_overrides_static(self, monkeypatch):
        """When enabled, the live OpenRouter catalog supersedes the static table."""
        from main_agent.agents.orchestrator.app_types.shared.services import pricing_service as ps

        class _FakeResp:
            def raise_for_status(self):
                return None

            def json(self):
                # Live per-token prices (USD/token) → 1.0 in / 2.0 out per 1M.
                return {
                    "data": [
                        {
                            "id": "deepseek/deepseek-chat",
                            "pricing": {
                                "prompt": "0.000001",
                                "completion": "0.000002",
                                "input_cache_read": "0.0000001",
                            },
                        }
                    ]
                }

        monkeypatch.setenv("OPENROUTER_PRICING_LIVE", "true")
        monkeypatch.setattr(ps, "_LIVE_CATALOG", None)
        import httpx

        monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResp())

        try:
            meta = _meta(prompt_tokens=1_000_000, candidates_tokens=1_000_000)
            cost = ps.calculate_openrouter_cost(meta, "deepseek/deepseek-chat")
            # 1M * $1.0/1M in + 1M * $2.0/1M out = $3.00 (live), not the static table.
            assert cost == pytest.approx(3.00)
        finally:
            monkeypatch.setattr(ps, "_LIVE_CATALOG", None)


class TestCalculateCostDispatcher:
    """Tests for the provider-agnostic calculate_cost dispatcher."""

    @pytest.mark.unit
    def test_gemini_model_routes_to_gemini(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_cost,
            calculate_gemini_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        assert calculate_cost(meta, "gemini-2.5-flash") == calculate_gemini_cost(
            meta, "gemini-2.5-flash"
        )

    @pytest.mark.unit
    def test_none_model_routes_to_gemini_default(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_cost,
            calculate_gemini_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        assert calculate_cost(meta, None) == calculate_gemini_cost(meta, None)

    @pytest.mark.unit
    def test_openrouter_model_routes_to_openrouter(self):
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_cost,
            calculate_openrouter_cost,
        )

        meta = _meta(prompt_tokens=10_000, candidates_tokens=5_000)
        assert calculate_cost(meta, "openrouter/deepseek/deepseek-chat") == (
            calculate_openrouter_cost(meta, "openrouter/deepseek/deepseek-chat")
        )

    @pytest.mark.unit
    def test_non_gemini_far_cheaper_than_old_gemini_fallback(self):
        """The headline fix: a DeepSeek run is no longer billed at gemini-3-pro rates."""
        from main_agent.agents.orchestrator.app_types.shared.services.pricing_service import (
            calculate_cost,
            calculate_gemini_cost,
        )

        # ~Gemini-3-Flash-shaped run from the user's report.
        meta = _meta(prompt_tokens=311_862, candidates_tokens=22_668, thoughts_tokens=13_804)
        deepseek = calculate_cost(meta, "openrouter/deepseek/deepseek-chat")
        old_behaviour = calculate_gemini_cost(meta, "openrouter/deepseek/deepseek-chat")  # → gpro
        assert deepseek < old_behaviour
        # Old path would have charged tier-2 gemini-3-pro ($4 in / $18 out): >$1.
        assert old_behaviour > 1.0
        assert deepseek < 0.30
