"""Unit tests for configuration module."""

import importlib
import os
import pytest
from unittest.mock import patch

from google.adk.models.google_llm import Gemini

from config import (
    AGENT_MODELS,
    AgentName,
    MAX_CONCURRENT_SUB_AGENTS,
    MAX_REPAIR_ATTEMPTS,
    MAX_RETRY_ATTEMPTS,
    RATE_LIMIT_MAX_RETRIES,
    RATE_LIMIT_INITIAL_DELAY,
    RATE_LIMIT_MAX_DELAY,
    RATE_LIMIT_BACKOFF_MULTIPLIER,
    RATE_LIMIT_JITTER,
    RATE_LIMIT_BATCH_DELAY,
    # Content handling configuration
    DOCUMENT_MAX_SIZE_CHARS,
    IMAGE_CATALOG_SUMMARY_LIMIT,
    IMAGE_DESCRIPTION_MAX_LENGTH,
    DOCUMENT_FETCH_MAX_RETRIES,
    DOCUMENT_FETCH_INITIAL_DELAY,
    DOCUMENT_FETCH_BACKOFF_MULTIPLIER,
    DOCUMENT_FETCH_TIMEOUT,
    get_agent_model,
    get_agent_model_name,
)


@pytest.fixture
def native_gemini_provider():
    """Pin LLM provider selection to the documented default (native Gemini).

    ``get_agent_model`` is provider-agnostic: with ``EXEPAD_LLM_PROVIDER``
    unset it builds a native ADK ``Gemini`` adapter; with any other provider
    (openrouter / deepseek / ollama / ...) it builds a LiteLLM adapter instead.

    ``agent_api`` calls ``load_dotenv()`` at import time, and the autouse
    ``_reset_agent_api_state`` fixture in ``tests/conftest.py`` imports
    ``agent_api`` during teardown — so an operator's local ``.env`` anywhere up
    the tree silently injects its provider settings into ``os.environ`` partway
    through the session. Strip them here so these tests assert the default the
    docstrings describe instead of whatever the host machine is pointed at.
    """
    with patch.dict(os.environ, {}, clear=False):
        for key in (
            "EXEPAD_LLM_PROVIDER",
            "EXEPAD_LLM_MODEL_DEFAULT",
            "EXEPAD_LLM_API_KEY",
            "EXEPAD_LLM_BASE_URL",
        ):
            os.environ.pop(key, None)
        yield


class TestAgentConfig:
    """Tests for agent configuration."""

    @pytest.mark.unit
    def test_all_agents_have_models(self):
        """Every AgentName enum should have a configured model."""
        for agent in AgentName:
            assert agent in AGENT_MODELS, f"Missing model for {agent}"

    @pytest.mark.unit
    def test_get_agent_model_by_enum(self, native_gemini_provider):
        """get_agent_model should return a Gemini adapter with retry_options."""
        model = get_agent_model(AgentName.CREATOR)

        assert model is not None
        assert isinstance(model, Gemini)
        assert model.model is not None
        assert model.retry_options is not None

    @pytest.mark.unit
    def test_get_agent_model_by_string(self, native_gemini_provider):
        """get_agent_model should work with string values."""
        model = get_agent_model("Creator")

        assert model is not None
        assert isinstance(model, Gemini)

    @pytest.mark.unit
    def test_get_agent_model_non_gemini_provider_uses_litellm(self):
        """A non-Gemini EXEPAD_LLM_PROVIDER must route through LiteLLM.

        Locks in the other half of the provider switch these tests depend on:
        the native ``Gemini`` adapter is the *default*, not the only outcome.
        """
        from google.adk.models.lite_llm import LiteLlm

        with patch.dict(
            os.environ,
            {
                "EXEPAD_LLM_PROVIDER": "openrouter",
                "EXEPAD_LLM_MODEL_DEFAULT": "deepseek/deepseek-chat",
            },
            clear=False,
        ):
            model = get_agent_model(AgentName.CREATOR)

        assert isinstance(model, LiteLlm)
        assert not isinstance(model, Gemini)
        # gemini-* defaults are swapped for EXEPAD_LLM_MODEL_DEFAULT and the
        # provider slug is prefixed for LiteLLM routing.
        assert model.model == "openrouter/deepseek/deepseek-chat"

    @pytest.mark.unit
    def test_get_agent_model_name_by_enum(self):
        """get_agent_model_name should return a model name string."""
        model_name = get_agent_model_name(AgentName.CREATOR)

        assert model_name is not None
        assert isinstance(model_name, str)
        assert len(model_name) > 0

    @pytest.mark.unit
    def test_get_agent_model_name_by_string(self):
        """get_agent_model_name should work with string values."""
        model_name = get_agent_model_name("Creator")

        assert model_name is not None
        assert isinstance(model_name, str)

    @pytest.mark.unit
    def test_unknown_agent_raises_error(self):
        """Unknown agent name should raise KeyError."""
        with pytest.raises(KeyError) as exc_info:
            get_agent_model("NonExistentAgent")

        assert "NonExistentAgent" in str(exc_info.value)

    @pytest.mark.unit
    def test_unknown_agent_name_raises_error(self):
        """Unknown agent name should raise KeyError for get_agent_model_name."""
        with pytest.raises(KeyError) as exc_info:
            get_agent_model_name("NonExistentAgent")

        assert "NonExistentAgent" in str(exc_info.value)

    @pytest.mark.unit
    def test_agent_models_are_valid_strings(self):
        """All agent models should be valid non-empty strings."""
        for agent, model in AGENT_MODELS.items():
            assert isinstance(model, str), f"Model for {agent} is not a string"
            assert len(model) > 0, f"Model for {agent} is empty"

    @pytest.mark.unit
    def test_core_agents_exist(self):
        """Core agents should be defined in AgentName enum."""
        core_agents = [
            AgentName.CREATOR,
            AgentName.EDITOR,
            AgentName.COMPONENT_BUILDER,
            AgentName.RESULT_RESPONSE_WRITER,
        ]

        for agent in core_agents:
            assert agent in AgentName
            assert agent in AGENT_MODELS


class TestConfigConstants:
    """Tests for configuration constants."""

    @pytest.mark.unit
    def test_max_repair_attempts_positive(self):
        """MAX_REPAIR_ATTEMPTS should be a positive integer."""
        assert isinstance(MAX_REPAIR_ATTEMPTS, int)
        assert MAX_REPAIR_ATTEMPTS > 0

    @pytest.mark.unit
    def test_max_retry_attempts_positive(self):
        """MAX_RETRY_ATTEMPTS should be a positive integer."""
        assert isinstance(MAX_RETRY_ATTEMPTS, int)
        assert MAX_RETRY_ATTEMPTS > 0

    @pytest.mark.unit
    def test_max_concurrent_sub_agents_positive(self):
        """MAX_CONCURRENT_SUB_AGENTS should be a positive integer."""
        assert isinstance(MAX_CONCURRENT_SUB_AGENTS, int)
        assert MAX_CONCURRENT_SUB_AGENTS > 0

    @pytest.mark.unit
    def test_reasonable_retry_limits(self):
        """Retry limits should be reasonable (not too high)."""
        assert MAX_REPAIR_ATTEMPTS <= 20
        assert MAX_RETRY_ATTEMPTS <= 20


class TestEnvKeyMap:
    """Tests for explicit env key mapping."""

    @pytest.mark.unit
    def test_all_agents_have_env_key_mapping(self):
        """Every AgentName enum should have an explicit _ENV_KEY_MAP entry."""
        from config import _ENV_KEY_MAP

        for agent in AgentName:
            assert agent in _ENV_KEY_MAP, f"Missing _ENV_KEY_MAP entry for {agent}"

    @pytest.mark.unit
    def test_env_key_format(self):
        """All env keys should follow UPPER_SNAKE_CASE_MODEL pattern."""
        from config import _ENV_KEY_MAP

        for agent, env_key in _ENV_KEY_MAP.items():
            assert env_key.endswith(
                "_MODEL"
            ), f"Env key for {agent} doesn't end with _MODEL: {env_key}"
            assert (
                env_key == env_key.upper()
            ), f"Env key for {agent} is not UPPER_SNAKE_CASE: {env_key}"

    @pytest.mark.unit
    def test_legacy_model_env_var_alias_is_honored(self, caplog):
        """Deprecated model env vars still work, with a warning."""
        import config as config_module

        with patch.dict(os.environ, {"APP_CREATOR_MODEL": "gemini-legacy-creator"}, clear=False):
            caplog.clear()
            with caplog.at_level("WARNING"):
                reloaded = importlib.reload(config_module)

            assert reloaded.get_agent_model_name(AgentName.CREATOR) == "gemini-legacy-creator"
            assert "Deprecated model env var APP_CREATOR_MODEL" in caplog.text

        importlib.reload(config_module)

    @pytest.mark.unit
    def test_ignored_legacy_model_env_var_warns(self, caplog):
        """Removed model env vars emit a warning instead of failing silently."""
        import config as config_module

        with patch.dict(
            os.environ, {"JSON_COMPONENT_BUILDER_MODEL": "gemini-obsolete"}, clear=False
        ):
            caplog.clear()
            with caplog.at_level("WARNING"):
                importlib.reload(config_module)

            assert "Ignoring deprecated model env var JSON_COMPONENT_BUILDER_MODEL" in caplog.text

        importlib.reload(config_module)


class TestRateLimitConfig:
    """Tests for rate limit configuration constants."""

    @pytest.mark.unit
    def test_rate_limit_max_retries_positive(self):
        """RATE_LIMIT_MAX_RETRIES should be a positive integer."""
        assert isinstance(RATE_LIMIT_MAX_RETRIES, int)
        assert RATE_LIMIT_MAX_RETRIES > 0

    @pytest.mark.unit
    def test_rate_limit_max_retries_reasonable(self):
        """RATE_LIMIT_MAX_RETRIES should be reasonable (not too high)."""
        assert RATE_LIMIT_MAX_RETRIES <= 20

    @pytest.mark.unit
    def test_rate_limit_initial_delay_positive(self):
        """RATE_LIMIT_INITIAL_DELAY should be a positive number."""
        assert isinstance(RATE_LIMIT_INITIAL_DELAY, (int, float))
        assert RATE_LIMIT_INITIAL_DELAY > 0

    @pytest.mark.unit
    def test_rate_limit_max_delay_positive(self):
        """RATE_LIMIT_MAX_DELAY should be a positive number."""
        assert isinstance(RATE_LIMIT_MAX_DELAY, (int, float))
        assert RATE_LIMIT_MAX_DELAY > 0

    @pytest.mark.unit
    def test_rate_limit_max_delay_greater_than_initial(self):
        """RATE_LIMIT_MAX_DELAY should be greater than or equal to initial delay."""
        assert RATE_LIMIT_MAX_DELAY >= RATE_LIMIT_INITIAL_DELAY

    @pytest.mark.unit
    def test_rate_limit_backoff_multiplier_greater_than_one(self):
        """RATE_LIMIT_BACKOFF_MULTIPLIER should be greater than 1 for exponential backoff."""
        assert isinstance(RATE_LIMIT_BACKOFF_MULTIPLIER, (int, float))
        assert RATE_LIMIT_BACKOFF_MULTIPLIER > 1

    @pytest.mark.unit
    def test_rate_limit_jitter_is_boolean(self):
        """RATE_LIMIT_JITTER should be a boolean."""
        assert isinstance(RATE_LIMIT_JITTER, bool)

    @pytest.mark.unit
    def test_rate_limit_batch_delay_non_negative(self):
        """RATE_LIMIT_BATCH_DELAY should be non-negative."""
        assert isinstance(RATE_LIMIT_BATCH_DELAY, (int, float))
        assert RATE_LIMIT_BATCH_DELAY >= 0

    @pytest.mark.unit
    def test_rate_limit_batch_delay_reasonable(self):
        """RATE_LIMIT_BATCH_DELAY should be reasonable (not too long)."""
        # Batch delay should not be more than 10 seconds
        assert RATE_LIMIT_BATCH_DELAY <= 10

    @pytest.mark.unit
    def test_exponential_backoff_reaches_max(self):
        """Exponential backoff should eventually reach max delay."""
        delay = RATE_LIMIT_INITIAL_DELAY
        for _ in range(RATE_LIMIT_MAX_RETRIES):
            delay = min(delay * RATE_LIMIT_BACKOFF_MULTIPLIER, RATE_LIMIT_MAX_DELAY)

        # After max retries, delay should be capped at max
        assert delay <= RATE_LIMIT_MAX_DELAY


class TestContentHandlingConfig:
    """Tests for content handling configuration constants."""

    @pytest.mark.unit
    def test_document_max_size_chars_default(self):
        """DOCUMENT_MAX_SIZE_CHARS should have default value of 50000."""
        assert DOCUMENT_MAX_SIZE_CHARS == 50000

    @pytest.mark.unit
    def test_document_max_size_chars_type(self):
        """DOCUMENT_MAX_SIZE_CHARS should be an integer."""
        assert isinstance(DOCUMENT_MAX_SIZE_CHARS, int)
        assert DOCUMENT_MAX_SIZE_CHARS > 0

    @pytest.mark.unit
    def test_image_catalog_summary_limit_default(self):
        """IMAGE_CATALOG_SUMMARY_LIMIT should have default value of 10."""
        assert IMAGE_CATALOG_SUMMARY_LIMIT == 10

    @pytest.mark.unit
    def test_image_catalog_summary_limit_type(self):
        """IMAGE_CATALOG_SUMMARY_LIMIT should be a positive integer."""
        assert isinstance(IMAGE_CATALOG_SUMMARY_LIMIT, int)
        assert IMAGE_CATALOG_SUMMARY_LIMIT > 0

    @pytest.mark.unit
    def test_image_description_max_length_default(self):
        """IMAGE_DESCRIPTION_MAX_LENGTH should have default value of 60."""
        assert IMAGE_DESCRIPTION_MAX_LENGTH == 60

    @pytest.mark.unit
    def test_image_description_max_length_type(self):
        """IMAGE_DESCRIPTION_MAX_LENGTH should be a positive integer."""
        assert isinstance(IMAGE_DESCRIPTION_MAX_LENGTH, int)
        assert IMAGE_DESCRIPTION_MAX_LENGTH > 0

    @pytest.mark.unit
    def test_document_fetch_max_retries_default(self):
        """DOCUMENT_FETCH_MAX_RETRIES should have default value of 3."""
        assert DOCUMENT_FETCH_MAX_RETRIES == 3

    @pytest.mark.unit
    def test_document_fetch_max_retries_type(self):
        """DOCUMENT_FETCH_MAX_RETRIES should be a positive integer."""
        assert isinstance(DOCUMENT_FETCH_MAX_RETRIES, int)
        assert DOCUMENT_FETCH_MAX_RETRIES > 0

    @pytest.mark.unit
    def test_document_fetch_initial_delay_default(self):
        """DOCUMENT_FETCH_INITIAL_DELAY should have default value of 1.0."""
        assert DOCUMENT_FETCH_INITIAL_DELAY == 1.0

    @pytest.mark.unit
    def test_document_fetch_initial_delay_type(self):
        """DOCUMENT_FETCH_INITIAL_DELAY should be a positive number."""
        assert isinstance(DOCUMENT_FETCH_INITIAL_DELAY, (int, float))
        assert DOCUMENT_FETCH_INITIAL_DELAY > 0

    @pytest.mark.unit
    def test_document_fetch_backoff_multiplier_default(self):
        """DOCUMENT_FETCH_BACKOFF_MULTIPLIER should have default value of 2.0."""
        assert DOCUMENT_FETCH_BACKOFF_MULTIPLIER == 2.0

    @pytest.mark.unit
    def test_document_fetch_backoff_multiplier_type(self):
        """DOCUMENT_FETCH_BACKOFF_MULTIPLIER should be greater than 1."""
        assert isinstance(DOCUMENT_FETCH_BACKOFF_MULTIPLIER, (int, float))
        assert DOCUMENT_FETCH_BACKOFF_MULTIPLIER > 1

    @pytest.mark.unit
    def test_document_fetch_timeout_default(self):
        """DOCUMENT_FETCH_TIMEOUT should have default value of 30."""
        assert DOCUMENT_FETCH_TIMEOUT == 30

    @pytest.mark.unit
    def test_document_fetch_timeout_type(self):
        """DOCUMENT_FETCH_TIMEOUT should be a positive integer."""
        assert isinstance(DOCUMENT_FETCH_TIMEOUT, int)
        assert DOCUMENT_FETCH_TIMEOUT > 0

    @pytest.mark.unit
    def test_document_fetch_backoff_calculation(self):
        """Document fetch exponential backoff should reach reasonable values."""
        delay = DOCUMENT_FETCH_INITIAL_DELAY
        for _ in range(DOCUMENT_FETCH_MAX_RETRIES):
            delay *= DOCUMENT_FETCH_BACKOFF_MULTIPLIER

        # After max retries with default values: 1.0 * 2^3 = 8.0 seconds
        # Should not exceed 1 minute even with more retries
        assert delay <= 60

    @pytest.mark.unit
    def test_content_config_reasonable_limits(self):
        """Content handling limits should be reasonable."""
        # Document size should be between 10KB and 1MB in characters
        assert 10000 <= DOCUMENT_MAX_SIZE_CHARS <= 1000000

        # Image catalog summary should show at least 1 and at most 50 images
        assert 1 <= IMAGE_CATALOG_SUMMARY_LIMIT <= 50

        # Description max length should be reasonable for display
        assert 20 <= IMAGE_DESCRIPTION_MAX_LENGTH <= 500

        # Timeout should be between 5 and 120 seconds
        assert 5 <= DOCUMENT_FETCH_TIMEOUT <= 120
