"""Unit tests for the provider-agnostic model resolution (WS6: LiteLLM layer).

Verifies config.get_agent_model() branches correctly on EXEPAD_LLM_PROVIDER:
native ADK Gemini by default, ADK LiteLlm for any other vendor.
"""

import os

import pytest
from google.adk.models.lite_llm import LiteLlm

from config import (
    AgentName,
    get_agent_model,
    _litellm_model_id,
    _openrouter_provider_routing,
    _build_model_for_name,
)


@pytest.fixture(autouse=True)
def _clear_llm_env(monkeypatch):
    for var in (
        "EXEPAD_LLM_PROVIDER",
        "EXEPAD_LLM_API_KEY",
        "EXEPAD_LLM_BASE_URL",
        "EXEPAD_LLM_MODEL_DEFAULT",
        "EXEPAD_LLM_PROVIDER_ORDER",
        "EXEPAD_LLM_PROVIDER_SORT",
        "EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS",
    ):
        monkeypatch.delenv(var, raising=False)


def test_litellm_model_id_prefixing():
    # Already-prefixed ids pass through unchanged.
    assert _litellm_model_id("openrouter", "openrouter/anthropic/claude-3.5-sonnet") == (
        "openrouter/anthropic/claude-3.5-sonnet"
    )
    # OpenRouter model ids are themselves "vendor/model" and MUST keep the
    # openrouter/ routing prefix — the slash is part of the id, not a provider
    # tag. Regression guard: the old code dropped the prefix on any id with a
    # slash, mis-routing every OpenRouter model to the wrong vendor.
    assert _litellm_model_id("openrouter", "anthropic/claude-3.5-sonnet") == (
        "openrouter/anthropic/claude-3.5-sonnet"
    )
    assert _litellm_model_id("openrouter", "deepseek/deepseek-v4-flash") == (
        "openrouter/deepseek/deepseek-v4-flash"
    )
    assert _litellm_model_id("openrouter", "openai/gpt-4o") == "openrouter/openai/gpt-4o"
    # Bare model names get the provider prefix.
    assert _litellm_model_id("anthropic", "claude-sonnet-4-5") == "anthropic/claude-sonnet-4-5"
    # OpenAI-compatible providers map to the "openai" prefix.
    assert _litellm_model_id("custom", "llama3.1") == "openai/llama3.1"
    assert _litellm_model_id("openai-compatible", "qwen2.5") == "openai/qwen2.5"
    # Unknown providers fall back to using the provider name as the prefix.
    assert _litellm_model_id("cohere", "command-r") == "cohere/command-r"


def test_default_provider_is_native_gemini():
    m = get_agent_model(AgentName.CREATOR)
    assert type(m).__name__ == "TimedGemini"
    assert m.model.startswith("gemini-")


def test_explicit_gemini_provider_is_native(monkeypatch):
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "gemini")
    assert type(get_agent_model(AgentName.CREATOR)).__name__ == "TimedGemini"


def test_litellm_tolerates_malformed_tool_call_json(monkeypatch):
    """Regression: weaker providers (deepseek-v4-flash via OpenRouter) sometimes
    return tool-call arguments that are valid JSON followed by trailing junk
    ("Extra data: line 1 column N"). Building a LiteLlm installs a tolerant
    parser so this salvages the first JSON value (or degrades to {}) instead of
    raising JSONDecodeError and aborting the whole parallel build.
    """
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("EXEPAD_LLM_API_KEY", "sk-or-x")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "deepseek/deepseek-v4-flash")
    import config

    config._build_model_for_name("gemini-3-flash-preview")  # applies the patch
    from google.adk.models import lite_llm

    parse = lite_llm._parse_tool_call_arguments
    # valid JSON + trailing junk → salvage the real object
    assert parse('{"tsx": "<div/>"}  garbage') == {"tsx": "<div/>"}
    # concatenated objects → first value wins (no crash)
    assert parse('{}{"tsx": "x"}') == {}
    # clean JSON still parses normally
    assert parse('{"a": 1}') == {"a": 1}
    # unrecoverable garbage → empty args, never raises
    assert parse("not json at all") == {}


def test_rebind_reaches_nested_pool_slot_agents(monkeypatch):
    """Regression: apply_runtime_settings must rebind agents nested in module-level
    lists and in ``sub_agents`` — the topology of the ComponentBuilder slot pool —
    not just top-level module singletons. These slot agents' names are NOT in
    AGENT_MODELS, so the rebinder must key off each agent's original model name.

    Repros the production crash where the parallel component build ran 4
    TimedGemini slot agents with no API key after the operator selected OpenRouter.
    """
    import sys
    import types
    from google.adk.agents import LlmAgent
    import config

    # Start from the Gemini default (no provider env), as a fresh server would.
    llm_keys = (
        "EXEPAD_LLM_PROVIDER",
        "EXEPAD_LLM_API_KEY",
        "EXEPAD_LLM_BASE_URL",
        "EXEPAD_LLM_MODEL_DEFAULT",
    )
    for k in llm_keys:
        monkeypatch.delenv(k, raising=False)

    def mk(name: str) -> LlmAgent:
        return LlmAgent(name=name, model=config._build_model_for_name("gemini-3-flash-preview"))

    slot1, slot2 = mk("component_builder_slot_1"), mk("component_builder_slot_2")
    nested = mk("component_builder_slot_3")
    parent = LlmAgent(
        name="wrapper_parent",
        model=config._build_model_for_name("gemini-3-flash-preview"),
        sub_agents=[nested],
    )
    all_agents = [slot1, slot2, parent, nested]

    fake = types.ModuleType("main_agent.faketest_rebind")
    fake.slots = [slot1, slot2]  # module-level list (like component_builder_slots)
    fake.parent = parent  # nested via sub_agents (like component_builder_parallel)
    sys.modules["main_agent.faketest_rebind"] = fake

    saved = {k: os.environ.get(k) for k in llm_keys}
    try:
        assert all(type(a.model).__name__ == "TimedGemini" for a in all_agents)

        config.apply_runtime_settings(
            {
                "llm": {
                    "provider": "openrouter",
                    "api_key": "sk-or-x",
                    "model": "deepseek/deepseek-v4-flash",
                }
            }
        )

        for a in all_agents:
            assert isinstance(a.model, LiteLlm), f"{a.name} not rebound"
            assert a.model.model == "openrouter/deepseek/deepseek-v4-flash", a.name
    finally:
        sys.modules.pop("main_agent.faketest_rebind", None)
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        config.rebind_runtime_models()  # reset any real agents back to env default


def test_apply_runtime_settings_image_provider_and_keep_llm_urls(monkeypatch):
    """The image block of the /r payload lands on os.environ: the selected
    provider activates (others cleared) and the keep-LLM-URLs toggle sets
    KEEP_LLM_IMAGE_URLS as a 'true'/'false' string."""
    import config

    for k in ("IMAGE_PROVIDER", "PEXELS_API_KEY", "UNSPLASH_API_KEY", "PIXABAY_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("UNSPLASH_API_KEY", "stale-should-be-cleared")
    monkeypatch.delenv("KEEP_LLM_IMAGE_URLS", raising=False)

    # Pexels selected + LLM URLs disabled.
    config.apply_runtime_settings(
        {
            "image_provider": "pexels",
            "pexels_api_key": "px-key",
            "keep_llm_image_urls": False,
        }
    )
    assert os.environ["IMAGE_PROVIDER"] == "pexels"
    assert os.environ["PEXELS_API_KEY"] == "px-key"
    assert "UNSPLASH_API_KEY" not in os.environ  # non-selected keyed provider dropped
    assert os.environ["KEEP_LLM_IMAGE_URLS"] == "false"

    # Re-enabling keeps LLM URLs; a non-boolean value is ignored (no-op).
    config.apply_runtime_settings({"keep_llm_image_urls": True})
    assert os.environ["KEEP_LLM_IMAGE_URLS"] == "true"
    config.apply_runtime_settings({"keep_llm_image_urls": "yes"})  # not a bool → unchanged
    assert os.environ["KEEP_LLM_IMAGE_URLS"] == "true"


def test_anthropic_provider_uses_litellm_with_default_fallback(monkeypatch):
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "claude-sonnet-4-5")
    monkeypatch.setenv("EXEPAD_LLM_API_KEY", "sk-ant-test")
    m = get_agent_model(AgentName.CREATOR)
    # gemini-* default falls back to EXEPAD_LLM_MODEL_DEFAULT on a non-Gemini provider.
    assert isinstance(m, LiteLlm)
    assert m.model == "anthropic/claude-sonnet-4-5"


def test_custom_openai_compatible_provider(monkeypatch):
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "custom")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "llama3.1")
    monkeypatch.setenv("EXEPAD_LLM_BASE_URL", "http://localhost:11434/v1")
    m = get_agent_model(AgentName.CREATOR)
    assert isinstance(m, LiteLlm)
    assert m.model == "openai/llama3.1"


# ─── OpenRouter provider-routing pin ─────────────────────────────────────────
# Regression + feature guard for _openrouter_provider_routing(): OpenRouter
# load-balances every call across providers, paying a cold routing/latency spike
# on the first calls of a run. Pinning `order`/`sort` disables that; the block is
# forwarded as extra_body={"provider": ...} and reaches OpenRouter's request body.


def test_provider_routing_none_when_unset():
    # No env knobs → no routing block (leaves OpenRouter's default behaviour).
    assert _openrouter_provider_routing() is None


def test_provider_routing_sort_only(monkeypatch):
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_SORT", "latency")
    assert _openrouter_provider_routing() == {"sort": "latency"}


def test_provider_routing_sort_is_validated(monkeypatch):
    # An unknown sort axis is ignored (not forwarded as a bad param).
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_SORT", "bogus")
    assert _openrouter_provider_routing() is None
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_SORT", "THROUGHPUT")  # case-insensitive
    assert _openrouter_provider_routing() == {"sort": "throughput"}


def test_provider_routing_order_and_fallbacks(monkeypatch):
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_ORDER", " Makora , DeepSeek ,, Novita ")
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS", "false")
    routing = _openrouter_provider_routing()
    # Whitespace trimmed, empty slugs dropped, order preserved.
    assert routing["order"] == ["Makora", "DeepSeek", "Novita"]
    assert routing["allow_fallbacks"] is False


def test_provider_routing_fallbacks_default_on(monkeypatch):
    # Without an explicit opt-out we do NOT pin allow_fallbacks — OpenRouter's own
    # default (true) applies, so a top-provider outage degrades instead of failing.
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_ORDER", "Makora")
    routing = _openrouter_provider_routing()
    assert routing == {"order": ["Makora"]}
    assert "allow_fallbacks" not in routing


def test_provider_routing_allow_fallbacks_only_is_noop(monkeypatch):
    # allow_fallbacks alone (no order/sort) has nothing to fall back FROM, so we
    # emit no routing block rather than a lone {"allow_fallbacks": False}.
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS", "false")
    assert _openrouter_provider_routing() is None


def test_openrouter_order_and_fallbacks_reach_extra_body(monkeypatch):
    # The `order` path (not just `sort`) lands in the built LiteLlm's extra_body,
    # with allow_fallbacks honored, whitespace trimmed and empty slugs dropped.
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("EXEPAD_LLM_API_KEY", "sk-or-x")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "deepseek/deepseek-v4-flash")
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_ORDER", "Makora, DeepSeek")
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS", "off")

    m = _build_model_for_name("gemini-3-flash-preview")
    assert m._additional_args.get("extra_body") == {
        "provider": {"order": ["Makora", "DeepSeek"], "allow_fallbacks": False}
    }


def test_openrouter_model_carries_provider_extra_body(monkeypatch):
    """The built OpenRouter LiteLlm forwards the provider pin as extra_body — ADK
    stashes unknown kwargs in _additional_args and passes them to acompletion."""
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("EXEPAD_LLM_API_KEY", "sk-or-x")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "deepseek/deepseek-v4-flash")
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_SORT", "latency")

    m = _build_model_for_name("gemini-3-flash-preview")
    assert isinstance(m, LiteLlm)
    assert m.model == "openrouter/deepseek/deepseek-v4-flash"
    assert m._additional_args.get("extra_body") == {"provider": {"sort": "latency"}}


def test_openrouter_no_extra_body_when_pin_unset(monkeypatch):
    # Pin absent → no extra_body key at all (fully back-compatible default path).
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("EXEPAD_LLM_API_KEY", "sk-or-x")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "deepseek/deepseek-v4-flash")

    m = _build_model_for_name("gemini-3-flash-preview")
    assert "extra_body" not in m._additional_args


def test_non_openrouter_provider_ignores_provider_pin(monkeypatch):
    # The `provider` block is an OpenRouter-only concept — never attach it to a
    # different vendor's call even if the pin env vars happen to be set.
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("EXEPAD_LLM_MODEL_DEFAULT", "claude-sonnet-4-5")
    monkeypatch.setenv("EXEPAD_LLM_API_KEY", "sk-ant-test")
    monkeypatch.setenv("EXEPAD_LLM_PROVIDER_SORT", "latency")

    m = _build_model_for_name("gemini-3-flash-preview")
    assert "extra_body" not in m._additional_args


def test_apply_runtime_settings_overlays_provider_pin(monkeypatch):
    """The worker sends the pin in the /r llm block; apply_runtime_settings must
    overlay it onto the env so the rebuilt models pick it up (no restart).

    Applying an LLM change rebinds the real module singletons, so we save/restore
    env and reset the rebind in a finally (mirrors test_rebind_...)."""
    import config

    llm_keys = (
        "EXEPAD_LLM_PROVIDER",
        "EXEPAD_LLM_API_KEY",
        "EXEPAD_LLM_MODEL_DEFAULT",
        "EXEPAD_LLM_PROVIDER_ORDER",
        "EXEPAD_LLM_PROVIDER_SORT",
    )
    saved = {k: os.environ.get(k) for k in llm_keys}
    try:
        config.apply_runtime_settings(
            {
                "llm": {
                    "provider": "openrouter",
                    "api_key": "sk-or-x",
                    "model": "deepseek/deepseek-v4-flash",
                    "provider_sort": "latency",
                    "provider_order": "Makora",
                }
            }
        )
        assert os.environ["EXEPAD_LLM_PROVIDER_SORT"] == "latency"
        assert os.environ["EXEPAD_LLM_PROVIDER_ORDER"] == "Makora"
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        config.rebind_runtime_models()  # reset real agents back to env default
