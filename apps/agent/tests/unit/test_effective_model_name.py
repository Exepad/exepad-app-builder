"""Unit tests for config.get_effective_model_name — provider-aware model
resolution used for cost attribution."""

import pytest


class TestEffectiveModelName:
    """The effective model must reflect the provider remap, not the base name."""

    @pytest.mark.unit
    def test_native_gemini_returns_base_name(self, monkeypatch):
        import config

        monkeypatch.delenv("EXEPAD_LLM_PROVIDER", raising=False)
        monkeypatch.setattr(config, "get_agent_model_name", lambda _name: "gemini-3-flash-preview")
        assert config.get_effective_model_name("AnyAgent") == "gemini-3-flash-preview"

    @pytest.mark.unit
    def test_openrouter_swaps_gemini_default_for_model_default(self, monkeypatch):
        """A gemini-* default on OpenRouter resolves to the configured OR model."""
        import config

        monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "openrouter")
        monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "deepseek/deepseek-chat")
        monkeypatch.setattr(config, "get_agent_model_name", lambda _name: "gemini-3-flash-preview")
        assert config.get_effective_model_name("AnyAgent") == "openrouter/deepseek/deepseek-chat"

    @pytest.mark.unit
    def test_openrouter_keeps_explicit_non_gemini_base(self, monkeypatch):
        """A per-agent non-gemini override keeps its id, gaining only the OR prefix."""
        import config

        monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "openrouter")
        monkeypatch.delenv("EXEPAD_LLM_MODEL_DEFAULT", raising=False)
        monkeypatch.setattr(
            config, "get_agent_model_name", lambda _name: "anthropic/claude-sonnet-4"
        )
        assert config.get_effective_model_name("AnyAgent") == "openrouter/anthropic/claude-sonnet-4"

    @pytest.mark.unit
    def test_deepseek_provider_prefixes_model(self, monkeypatch):
        import config

        monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "deepseek")
        monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "deepseek-chat")
        monkeypatch.setattr(config, "get_agent_model_name", lambda _name: "gemini-3-flash-preview")
        assert config.get_effective_model_name("AnyAgent") == "deepseek/deepseek-chat"

    @pytest.mark.unit
    def test_unknown_agent_raises_keyerror(self, monkeypatch):
        import config

        monkeypatch.delenv("EXEPAD_LLM_PROVIDER", raising=False)
        with pytest.raises(KeyError):
            config.get_effective_model_name("definitely-not-a-real-agent")
