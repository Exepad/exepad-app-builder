import os

import structlog
from google.genai.types import GenerateContentResponseUsageMetadata
from typing import NamedTuple

logger = structlog.get_logger(__name__)


class ModelPricing(NamedTuple):
    """Pricing configuration for a Gemini model (per 1M tokens in USD)."""

    input_tier1: float
    input_tier2: float | None  # None if no tier-based pricing
    output_tier1: float
    output_tier2: float | None  # None if no tier-based pricing
    cached_tier1: float
    cached_tier2: float | None  # None if no tier-based pricing


# Pricing per 1M tokens in USD (Paid Tier)
GEMINI_PRICING = {
    # Gemini 3 Pro Preview - tier-based pricing (>200k tokens)
    "gemini-3-pro-preview": ModelPricing(
        input_tier1=2.00,
        input_tier2=4.00,
        output_tier1=12.00,
        output_tier2=18.00,
        cached_tier1=0.20,
        cached_tier2=0.40,
    ),
    # Gemini 3.1 Pro Preview - tier-based pricing (>200k tokens).
    # Mirrors 3 Pro Preview rates; update if Google publishes different pricing.
    "gemini-3.1-pro-preview": ModelPricing(
        input_tier1=2.00,
        input_tier2=4.00,
        output_tier1=12.00,
        output_tier2=18.00,
        cached_tier1=0.20,
        cached_tier2=0.40,
    ),
    # Gemini 3 Flash Preview - flat pricing (no tiers)
    "gemini-3-flash-preview": ModelPricing(
        input_tier1=0.50,
        input_tier2=None,
        output_tier1=3.00,
        output_tier2=None,
        cached_tier1=0.05,
        cached_tier2=None,
    ),
    # Gemini 2.5 Pro - tier-based pricing (>200k tokens)
    "gemini-2.5-pro": ModelPricing(
        input_tier1=1.25,
        input_tier2=2.50,
        output_tier1=10.00,
        output_tier2=15.00,
        cached_tier1=0.125,
        cached_tier2=0.25,
    ),
    # Gemini 2.5 Flash - flat pricing (no tiers)
    "gemini-2.5-flash": ModelPricing(
        input_tier1=0.30,
        input_tier2=None,
        output_tier1=2.50,
        output_tier2=None,
        cached_tier1=0.03,
        cached_tier2=None,
    ),
}

# Default to Gemini 3 Pro Preview pricing for unknown models
DEFAULT_MODEL = "gemini-3-pro-preview"

# Tier threshold (200k tokens)
TIER_THRESHOLD = 200_000


def _match_gemini_key(model: str | None) -> str | None:
    """Return the GEMINI_PRICING key whose name appears in ``model``, else None.

    Substring match handles name variations like ``models/gemini-2.5-flash`` and
    ``gemini-2.5-flash-001``. Returns None for non-Gemini ids (e.g. LiteLLM /
    OpenRouter routing ids such as ``openrouter/deepseek/deepseek-chat``), which
    :func:`calculate_cost` then routes to OpenRouter pricing instead.
    """
    if not model:
        return None
    for key in GEMINI_PRICING:
        if key in model:
            return key
    return None


def calculate_gemini_cost(
    metadata: GenerateContentResponseUsageMetadata, model: str | None = None
) -> float:
    """
    Calculates the estimated cost in USD for Gemini API requests.

    Supports multiple Gemini models with their specific pricing:
    - gemini-3-pro-preview / gemini-3.1-pro-preview: Tier-based pricing (≤200k / >200k tokens)
    - gemini-3-flash-preview: Flat pricing
    - gemini-2.5-pro: Tier-based pricing (≤200k / >200k tokens)
    - gemini-2.5-flash: Flat pricing

    Args:
        metadata: The usage metadata from Gemini API response
        model: The model name (e.g., "gemini-3-pro-preview").
               Defaults to gemini-3-pro-preview if not specified.

    Returns:
        Estimated cost in USD
    """

    # --- 1. Get Model Pricing ---
    requested_model = model or DEFAULT_MODEL
    model_key = _match_gemini_key(requested_model)
    if model_key is None:
        logger.warning(
            "pricing.unknown_model_fallback",
            requested_model=requested_model,
            fallback_to=DEFAULT_MODEL,
        )
        model_key = DEFAULT_MODEL

    pricing = GEMINI_PRICING[model_key]

    # --- 2. Calculate Total Output (The Expensive Part) ---
    # Output Price applies to: Visible Candidates + Invisible Thoughts
    candidates = metadata.candidates_token_count or 0
    thoughts = metadata.thoughts_token_count or 0
    total_output = candidates + thoughts

    # --- 3. Calculate Total Input (The Cheaper Part) ---
    # prompt_token_count already includes tool-use tokens (tool_use_prompt_token_count
    # is a subset/breakdown of prompt_token_count, not additive)
    total_input = metadata.prompt_token_count or 0

    # --- 4. Determine Pricing Tier ---
    # Tier 2 pricing applies when input > 200k tokens (only for tier-based models)
    is_tier_2 = pricing.input_tier2 is not None and total_input > TIER_THRESHOLD

    # --- 5. Handle Caching ---
    cached_input = metadata.cached_content_token_count or 0
    standard_input = max(0, total_input - cached_input)

    # --- 6. Select Appropriate Prices ---
    if is_tier_2:
        input_price = pricing.input_tier2
        cached_price = pricing.cached_tier2
        output_price = pricing.output_tier2
    else:
        input_price = pricing.input_tier1
        cached_price = pricing.cached_tier1
        output_price = pricing.output_tier1

    # --- 7. Calculate Final Cost ---
    cost = (
        (standard_input / 1_000_000) * input_price
        + (cached_input / 1_000_000) * cached_price
        + (total_output / 1_000_000) * output_price
    )

    return cost


# ─────────────────────────────────────────────────────────────────────────────
# OpenRouter / LiteLLM pricing
#
# Self-host runs operator-chosen models through ADK's LiteLlm (OpenRouter,
# DeepSeek, OpenAI-compatible gateways, …). Those ids never match a Gemini SKU,
# so without this they fell back to gemini-3-pro-preview rates ($2–4 in /
# $12–18 out) — wildly overcharging cheap models. We price them here instead.
#
# Two sources, in priority order:
#   1. Live catalog from https://openrouter.ai/api/v1/models (authoritative,
#      per-token rates). Lazy, memoized once per process, fail-open. Gated by
#      OPENROUTER_PRICING_LIVE (default on; auto-disabled under pytest for
#      determinism unless the test opts in).
#   2. Static fallback table below — approximate list prices, may drift; enable
#      the live catalog for authoritative numbers.
# Anything still unresolved uses OPENROUTER_FALLBACK and logs a warning.
# ─────────────────────────────────────────────────────────────────────────────


class OpenRouterPricing(NamedTuple):
    """Flat pricing for a non-Gemini model (per 1M tokens in USD)."""

    input: float  # prompt tokens
    output: float  # completion tokens (visible + reasoning)
    cached: float  # cache-read input tokens


# Approximate OpenRouter list prices per 1M tokens, captured 2026-06. OpenRouter
# changes these often and per-provider — set OPENROUTER_PRICING_LIVE=true for
# authoritative per-token rates pulled from /api/v1/models. Keys are the
# canonical OpenRouter ids, lowercased (the "openrouter/" routing prefix is
# stripped before lookup, so "openrouter/deepseek/deepseek-chat" and the bare
# "deepseek/deepseek-chat" both resolve here).
OPENROUTER_PRICING: dict[str, OpenRouterPricing] = {
    "deepseek/deepseek-chat": OpenRouterPricing(0.28, 0.88, 0.028),
    "deepseek/deepseek-chat-v3-0324": OpenRouterPricing(0.28, 0.88, 0.028),
    "deepseek/deepseek-r1": OpenRouterPricing(0.55, 2.19, 0.14),
    "anthropic/claude-3.5-sonnet": OpenRouterPricing(3.00, 15.00, 0.30),
    "anthropic/claude-3.7-sonnet": OpenRouterPricing(3.00, 15.00, 0.30),
    "anthropic/claude-sonnet-4": OpenRouterPricing(3.00, 15.00, 0.30),
    "openai/gpt-4o": OpenRouterPricing(2.50, 10.00, 1.25),
    "openai/gpt-4o-mini": OpenRouterPricing(0.15, 0.60, 0.075),
    "openai/gpt-4.1": OpenRouterPricing(2.00, 8.00, 0.50),
    "openai/gpt-4.1-mini": OpenRouterPricing(0.40, 1.60, 0.10),
    "google/gemini-2.0-flash-001": OpenRouterPricing(0.10, 0.40, 0.025),
    "google/gemini-2.5-flash": OpenRouterPricing(0.30, 2.50, 0.075),
    "meta-llama/llama-3.3-70b-instruct": OpenRouterPricing(0.12, 0.30, 0.12),
    "qwen/qwen-2.5-72b-instruct": OpenRouterPricing(0.13, 0.40, 0.13),
    "mistralai/mistral-large": OpenRouterPricing(2.00, 6.00, 2.00),
    "mistralai/mistral-nemo": OpenRouterPricing(0.04, 0.10, 0.04),
    "x-ai/grok-2": OpenRouterPricing(2.00, 10.00, 2.00),
}

# Conservative mid-tier estimate for a non-Gemini model we can't otherwise
# price. Deliberately far below the old gemini-3-pro fallback so unknown models
# stop being grossly overcharged, but non-zero so the cost stays visible.
OPENROUTER_FALLBACK = OpenRouterPricing(1.00, 3.00, 0.25)

_OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# None = live catalog not yet attempted; dict (possibly empty) = attempted.
# Failures memoize as {} so we don't re-stall on a dead/offline endpoint.
_LIVE_CATALOG: dict[str, OpenRouterPricing] | None = None


def _env_true(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _live_catalog_enabled() -> bool:
    """Whether to fetch live OpenRouter pricing.

    Default on, but suppressed under pytest (``PYTEST_CURRENT_TEST``) unless a
    test explicitly sets ``OPENROUTER_PRICING_LIVE`` truthy, so the unit suite
    stays deterministic and network-free.
    """
    explicit = _env_true("OPENROUTER_PRICING_LIVE", False)
    if "PYTEST_CURRENT_TEST" in os.environ and not explicit:
        return False
    return _env_true("OPENROUTER_PRICING_LIVE", True)


def _load_live_openrouter_catalog() -> dict[str, OpenRouterPricing]:
    """Fetch + memoize OpenRouter's model catalog as per-1M pricing.

    One attempt per process, short timeout, fail-open to an empty dict (callers
    then fall through to the static table / fallback). The ``/api/v1/models``
    endpoint is public, so no API key is required.
    """
    global _LIVE_CATALOG
    if _LIVE_CATALOG is not None:
        return _LIVE_CATALOG

    catalog: dict[str, OpenRouterPricing] = {}
    if _live_catalog_enabled():
        try:
            import httpx

            timeout = float(os.environ.get("OPENROUTER_PRICING_TIMEOUT", "4"))
            resp = httpx.get(_OPENROUTER_MODELS_URL, timeout=timeout)
            resp.raise_for_status()
            for entry in resp.json().get("data", []):
                model_id = str(entry.get("id", "")).strip().lower()
                prices = entry.get("pricing") or {}
                if not model_id:
                    continue
                try:
                    # OpenRouter quotes USD *per token* as strings.
                    prompt = float(prices.get("prompt") or 0.0) * 1_000_000
                    completion = float(prices.get("completion") or 0.0) * 1_000_000
                    cache_read = prices.get("input_cache_read")
                    cached = (
                        float(cache_read) * 1_000_000 if cache_read not in (None, "") else prompt
                    )
                except (TypeError, ValueError):
                    continue
                catalog[model_id] = OpenRouterPricing(
                    input=prompt, output=completion, cached=cached
                )
            logger.info("pricing.openrouter_live_loaded", model_count=len(catalog))
        except Exception as exc:  # pragma: no cover - network/shape guard
            logger.warning("pricing.openrouter_live_failed", error=str(exc))
            catalog = {}

    _LIVE_CATALOG = catalog
    return _LIVE_CATALOG


def _normalize_openrouter_id(model: str | None) -> str:
    """Lowercase + strip the ``openrouter/`` routing prefix to the canonical id."""
    if not model:
        return ""
    model_id = model.strip().lower()
    if model_id.startswith("openrouter/"):
        model_id = model_id[len("openrouter/") :]
    return model_id


def _resolve_openrouter_pricing(model: str | None) -> OpenRouterPricing | None:
    """Resolve pricing for a non-Gemini model, or None if unknown.

    Tries the live catalog first, then the static table; for variant ids like
    ``deepseek/deepseek-chat:free`` it also tries the base id without the suffix.
    """
    model_id = _normalize_openrouter_id(model)
    if not model_id:
        return None

    candidates = [model_id]
    if ":" in model_id:
        candidates.append(model_id.split(":", 1)[0])

    live = _load_live_openrouter_catalog()
    for key in candidates:
        if key in live:
            return live[key]
    for key in candidates:
        if key in OPENROUTER_PRICING:
            return OPENROUTER_PRICING[key]
    return None


def calculate_openrouter_cost(
    metadata: GenerateContentResponseUsageMetadata, model: str | None = None
) -> float:
    """Estimate USD cost for a non-Gemini (LiteLLM/OpenRouter) model.

    Mirrors the Gemini cost shape: reasoning ("thoughts") tokens bill at the
    output rate, cache-read tokens at the cached rate. Unknown models use
    OPENROUTER_FALLBACK and log a warning rather than silently mispricing.
    """
    pricing = _resolve_openrouter_pricing(model)
    if pricing is None:
        logger.warning(
            "pricing.openrouter_unknown_model",
            requested_model=model,
            fallback="OPENROUTER_FALLBACK",
        )
        pricing = OPENROUTER_FALLBACK

    candidates = metadata.candidates_token_count or 0
    thoughts = metadata.thoughts_token_count or 0
    total_output = candidates + thoughts

    total_input = metadata.prompt_token_count or 0
    cached_input = metadata.cached_content_token_count or 0
    standard_input = max(0, total_input - cached_input)

    return (
        (standard_input / 1_000_000) * pricing.input
        + (cached_input / 1_000_000) * pricing.cached
        + (total_output / 1_000_000) * pricing.output
    )


def calculate_cost(
    metadata: GenerateContentResponseUsageMetadata, model: str | None = None
) -> float:
    """Provider-agnostic cost dispatcher.

    Routes Gemini SKUs (and a ``None`` model, which defaults to native Gemini)
    to :func:`calculate_gemini_cost`; everything else — LiteLLM / OpenRouter
    ids — to :func:`calculate_openrouter_cost`.
    """
    if model is None or _match_gemini_key(model) is not None:
        return calculate_gemini_cost(metadata, model)
    return calculate_openrouter_cost(metadata, model)
