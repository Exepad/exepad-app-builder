import copy
import os
import re
from datetime import datetime

import aiohttp
import structlog

logger = structlog.get_logger(__name__)

# Active stock-image provider (env var: "openverse", "pexels", "pixabay", or
# "unsplash"; default "pexels" for legacy installs). In the single-provider
# model the operator picks exactly one source in the Settings UI, and
# ``config.apply_runtime_settings`` activates only that provider's key env var
# (clearing the others), so the fallback chain in ``process_one_image_prop``
# naturally collapses to the one selection. When more than one keyed env var is
# set directly (advanced/legacy), this only nudges which is tried FIRST — the
# chain still tries every configured provider, then keyless Openverse.
IMAGE_PROVIDER = os.getenv("IMAGE_PROVIDER", "pexels").lower()

# Keyed keyword-search stock providers. When NONE of these is configured, the
# pipeline KEEPS the LLM's own image URLs instead of stripping them to
# __PLACEHOLDER__ (a keyed provider could re-source the placeholder; a keyless
# one is only used to fill genuine placeholders). Openverse and Lorem Picsum
# are deliberately NOT in this set — they are keyless, so their availability is
# not a reason to discard a topical URL the LLM chose. All three providers here
# are FREE (free API key, commercial-use license). No paid providers.
STOCK_PROVIDER_ENV_KEYS: tuple[str, ...] = (
    "PEXELS_API_KEY",
    "PIXABAY_API_KEY",
    "UNSPLASH_API_KEY",
)


def stock_provider_configured() -> bool:
    """True when at least one keyed keyword-search stock provider is present.

    Read at call time (not import time) so it reflects the per-build env set
    by ``config.apply_runtime_settings`` (which copies the operator's
    Settings-UI key into ``os.environ``). Openverse (keyless) is intentionally
    excluded — it is a fallback that only fills genuine placeholders, never a
    reason to strip a working LLM URL.
    """
    return any(os.getenv(k, "").strip() for k in STOCK_PROVIDER_ENV_KEYS)


# Operator toggle (Settings UI → ``KEEP_LLM_IMAGE_URLS``): whether generated
# apps may keep the image URLs the LLM suggests. Default ON — only an explicit
# falsey value turns it off. Read at call time so it honors the per-build env
# applied by ``config.apply_runtime_settings``.
_KEEP_LLM_URLS_FALSEY = frozenset({"0", "false", "no", "off"})


def keep_llm_image_urls() -> bool:
    """Whether the operator allows generated apps to keep LLM-suggested image URLs.

    Defaults to True (keep). Only an explicit falsey value in
    ``KEEP_LLM_IMAGE_URLS`` (``0``/``false``/``no``/``off``) turns it off.
    """
    return os.getenv("KEEP_LLM_IMAGE_URLS", "").strip().lower() not in _KEEP_LLM_URLS_FALSEY


def should_strip_llm_image_urls() -> bool:
    """Whether hallucinated / non-allowlisted LLM image URLs should be stripped to
    ``__PLACEHOLDER__`` and re-sourced through the stock-image pipeline.

    Backward-compatible: with the operator toggle left ON (the default), this is
    exactly ``stock_provider_configured()`` — the prior behavior (strip only when
    a keyed provider could re-source the placeholder). Turning the toggle OFF
    forces stripping regardless of provider, so every image is routed through the
    stock pipeline (keyed provider if configured, else keyless Openverse/Picsum).
    """
    return (not keep_llm_image_urls()) or stock_provider_configured()


# Pexels API configuration
PEXELS_API_URL = "https://api.pexels.com/v1/search"
PEXELS_TIMEOUT_SECONDS = 10

# Pixabay API configuration (free, requires a free API key)
PIXABAY_API_URL = "https://pixabay.com/api/"
PIXABAY_TIMEOUT_SECONDS = 10

# Unsplash API configuration
UNSPLASH_API_URL = "https://api.unsplash.com/search/photos"
UNSPLASH_TIMEOUT_SECONDS = 10

# Openverse API configuration (keyless — aggregates Creative-Commons imagery).
# Used as a last-resort keyword-searchable fallback; no API key required.
OPENVERSE_API_URL = "https://api.openverse.org/v1/images/"
OPENVERSE_TIMEOUT_SECONDS = 10


def _select_orientation(requested_width: int, requested_height: int) -> str | None:
    """Select Pexels orientation parameter based on requested dimensions.

    Returns None for square images (let Pexels decide).
    """
    if requested_width > requested_height:
        return "landscape"
    elif requested_height > requested_width:
        return "portrait"
    return None


def _pixabay_orientation(requested_width: int, requested_height: int) -> str:
    """Return Pixabay ``orientation`` param based on requested dimensions."""
    if requested_width > requested_height:
        return "horizontal"
    elif requested_height > requested_width:
        return "vertical"
    return "all"


def _openverse_orientation(requested_width: int, requested_height: int) -> str:
    """Return Openverse ``aspect_ratio`` filter based on requested dimensions."""
    if requested_width > requested_height:
        return "wide"
    elif requested_height > requested_width:
        return "tall"
    return "square"


def _normalize_image_url(url: str) -> str:
    """Ensure image URL uses HTTPS — some providers return http:// URLs."""
    if url.startswith("http://"):
        return "https://" + url[7:]
    return url


def _strip_query_params(url: str) -> str:
    """Strip query parameters from a URL for deduplication comparison."""
    return url.split("?", 1)[0] if url else url


def _select_image_url(src: dict, requested_width: int, requested_height: int) -> str:
    """Select the most appropriate image size URL from Pexels photo sources.

    Mobile-first tier selection. Pexels sizes:
    - original: full-res (very large, 3000px+)
    - large2x: ~1880 px
    - large: ~940 px
    - medium: ~600 px
    - small: ~225 px

    We pick the smallest tier that still covers the display box at 2x DPR.
    For a 400px card on a phone (2x DPR = 800px), "large" (~940) is plenty;
    "medium" (~600) may be too small. For a 200px avatar (2x = 400px),
    "medium" (~600) is ideal. Over-fetching murders LCP — these thresholds
    are biased toward smaller tiers.
    """
    # Treat the dominant dimension as the "size budget"
    budget = max(requested_width, requested_height)
    if budget >= 1600:
        url = src.get("original", src.get("large2x", src.get("large", "")))
    elif budget >= 1000:
        url = src.get("large2x", src.get("large", ""))
    elif budget >= 500:
        url = src.get("large", src.get("medium", ""))
    elif budget >= 250:
        url = src.get("medium", src.get("small", ""))
    else:
        url = src.get("small", src.get("medium", ""))
    return _normalize_image_url(url)


def _set_placeholder_asset(
    asset: dict,
    reason: str,
    provider_img_id: str = "placeholder",
    provider: str | None = None,
) -> None:
    """Set placeholder values on asset dict when image fetch fails."""
    asset["provider"] = provider or "Pexels"
    asset["providerImgId"] = provider_img_id
    asset["providerImgUrl"] = "#"
    asset["datetimeGenerated"] = datetime.now().isoformat()
    asset["isProcessed"] = False


_KEYWORD_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "in",
        "on",
        "at",
        "of",
        "for",
        "with",
        "and",
        "or",
        "is",
        "are",
        "to",
        "from",
        "by",
        "that",
        "this",
    }
)


# Compound terms to preserve as single search units
_COMPOUND_TERMS = [
    "architecture studio",
    "interior design",
    "team portrait",
    "office building",
    "city skyline",
    "real estate",
    "web design",
    "graphic design",
    "natural light",
    "modern office",
    "gold trophy",
    "living room",
    "dining room",
    "green building",
    "solar panels",
]


def _preprocess_keywords(raw_keywords: str) -> str:
    """Normalize keywords for stock photo API search.

    Converts comma-separated phrases into space-separated simple keywords,
    preserves recognized compound terms, removes filler words, and limits
    to 5 terms for optimal API results.
    """
    text = raw_keywords.lower().strip()

    # Protect compound terms by joining them with underscores temporarily
    protected: list[str] = []
    for compound in _COMPOUND_TERMS:
        if compound in text:
            placeholder = compound.replace(" ", "_")
            text = text.replace(compound, placeholder)
            protected.append(placeholder)

    # Split on commas and flatten multi-word phrases into individual words
    words = []
    for segment in text.split(","):
        words.extend(segment.strip().split())

    # Remove filler words that hurt search relevance
    filtered = [w for w in words if w not in _KEYWORD_STOP_WORDS]

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for w in filtered:
        if w not in seen:
            seen.add(w)
            unique.append(w)

    # Restore compound terms (underscores back to spaces)
    restored = []
    for w in unique:
        if w in protected:
            restored.append(w.replace("_", " "))
        else:
            restored.append(w)

    # Stock photo APIs work best with 3-5 comma-separated terms
    result = ", ".join(restored[:5])
    return result if result else raw_keywords.strip() or "abstract background"


def _build_query_variants(search_query: str) -> list[str]:
    """Build progressively simpler query variants for retry.

    Given "happy, chickens, pasture, farm", returns:
    ["happy, chickens, pasture, farm", "happy, chickens", "chickens", "pasture", "farm"]
    """
    terms = [t.strip() for t in search_query.split(",") if t.strip()]
    queries = [search_query]

    if len(terms) > 2:
        queries.append(", ".join(terms[:2]))

    for term in terms:
        if term not in queries and len(term) > 3:
            queries.append(term)

    return queries


async def get_image_from_pexels(
    processed_prop: dict,
    exclude_urls: set[str] | None = None,
    app_uuid: str = "",
) -> dict:
    """Fetch image from Pexels API based on keywords in the image asset.

    Args:
        processed_prop: ImageProps dictionary containing asset information
        exclude_urls: URLs to skip (for deduplication across image slots)
        app_uuid: App UUID for GCS upload. When set, the chosen Pexels CDN URL
            is downloaded and re-hosted under ``{app_uuid}/assets/images/`` so
            the TSX embeds an ``__ASSET_IMG:…__`` placeholder instead of the
            raw ``images.pexels.com`` URL. Empty string keeps the legacy
            CDN-direct behaviour (used by tests + non-deploy callers).

    Returns:
        Updated processed_prop with Pexels image data
    """
    api_key = os.getenv("PEXELS_API_KEY")

    if not api_key:
        logger.warning(
            "image_provider_api_key_missing — image forced to placeholder ('#'). "
            "Set PEXELS_API_KEY (or PIXABAY_API_KEY / UNSPLASH_API_KEY) to enable "
            "real image sourcing.",
            provider="Pexels",
        )
        _set_placeholder_asset(processed_prop.get("asset", {}), "no_api_key", provider="Pexels")
        return processed_prop

    try:
        asset = processed_prop.get("asset", {})
        keywords = asset.get("keywords", "abstract background")

        if isinstance(keywords, list):
            search_query = " ".join(keywords)
        else:
            search_query = str(keywords)

        search_query = _preprocess_keywords(search_query)

        requested_width = asset.get("requested_width", 1920)
        requested_height = asset.get("requested_height", 1080)

        logger.info(
            "Searching Pexels",
            query=search_query,
            dimensions=f"{requested_width}x{requested_height}",
        )

        headers = {"Authorization": api_key}
        base_params: dict = {
            "per_page": 5,
            "page": 1,
        }

        orientation = _select_orientation(requested_width, requested_height)
        if orientation:
            base_params["orientation"] = orientation

        _excluded = exclude_urls or set()

        async with aiohttp.ClientSession() as session:
            photo = None
            query_variants = _build_query_variants(search_query)
            for i, query in enumerate(query_variants):
                params = {**base_params, "query": query}
                async with session.get(
                    PEXELS_API_URL,
                    headers=headers,
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=PEXELS_TIMEOUT_SECONDS),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        photos = data.get("photos", [])
                        # Pick first non-duplicate photo
                        for candidate in photos:
                            candidate_url = _select_image_url(
                                candidate.get("src", {}),
                                requested_width,
                                requested_height,
                            )
                            if candidate_url not in _excluded:
                                photo = candidate
                                break
                        if not photo and photos:
                            photo = photos[0]  # fallback to first if all are dupes
                        if photo:
                            if query != search_query:
                                logger.info(
                                    "Pexels found result with simplified query",
                                    original=search_query,
                                    used=query,
                                )
                            break
                    elif response.status == 429:
                        logger.warning("Pexels API rate limited (429)")
                        _set_placeholder_asset(
                            asset, "rate_limited", provider_img_id="rate_limited", provider="Pexels"
                        )
                        return processed_prop
                    else:
                        response_text = await response.text()
                        logger.warning(
                            "Pexels API error", status=response.status, response=response_text[:200]
                        )
                        _set_placeholder_asset(
                            asset,
                            "api_error",
                            provider_img_id=f"error_{response.status}",
                            provider="Pexels",
                        )
                        return processed_prop

                if i < len(query_variants) - 1:
                    logger.info("No Pexels results, trying simpler query", query=query)

            if photo:
                src = photo.get("src", {})
                selected_url = _select_image_url(src, requested_width, requested_height)
                photo_id = str(photo.get("id"))

                # Provider images are served from the live CDN URL. (The cloud
                # topology re-hosted them to an object store → R2; that path was
                # removed with the GCS coupling.)
                image_url = selected_url

                asset["provider"] = "Pexels"
                asset["providerImgId"] = photo_id
                asset["providerImgUrl"] = image_url
                asset["datetimeGenerated"] = datetime.now().isoformat()
                asset["isProcessed"] = True

                processed_prop["src"] = image_url

                logger.info(
                    "Found Pexels image",
                    photographer=photo.get("photographer"),
                    photo_id=photo_id,
                )
            else:
                logger.warning("No Pexels results after all retries", query=search_query)
                _set_placeholder_asset(
                    asset, "no_results", provider_img_id="no_results", provider="Pexels"
                )

    except Exception as e:
        logger.error("Exception fetching from Pexels", error=str(e))
        _set_placeholder_asset(
            processed_prop.get("asset", {}),
            "exception",
            provider_img_id="exception",
            provider="Pexels",
        )

    return processed_prop


async def get_pexels_photo_by_id(
    processed_prop: dict,
    photo_id: str,
    app_uuid: str = "",
) -> dict:
    """Fetch a SPECIFIC Pexels photo by numeric ID.

    Used by the array-placeholder resolver when an array element has a
    preserved ``vendor: "pexels"`` + ``assetId:`` pair — so a "fix the
    hero overlay" edit doesn't replace already-resolved Pexels photos
    with new search results, and so a re-search doesn't collapse all
    array slots onto the same generic image.

    Returns ``processed_prop`` with ``src`` filled and asset metadata
    populated. On failure (404, network, no-API-key), the asset is
    marked with the appropriate placeholder reason and ``src`` stays
    empty so the caller can fall back to keyword search.

    The resolved CDN ``images.pexels.com`` URL is embedded directly in the
    TSX (object-store re-hosting was removed with the GCS coupling).
    """
    api_key = os.getenv("PEXELS_API_KEY")
    if not api_key:
        logger.error("PEXELS_API_KEY not found — by-id fetch cannot proceed")
        _set_placeholder_asset(processed_prop.get("asset", {}), "no_api_key", provider="Pexels")
        return processed_prop

    if not photo_id or not str(photo_id).strip():
        return processed_prop

    asset = processed_prop.get("asset", {})
    requested_width = asset.get("requested_width", 1920)
    requested_height = asset.get("requested_height", 1080)

    photo_id = str(photo_id).strip()
    url = f"https://api.pexels.com/v1/photos/{photo_id}"
    headers = {"Authorization": api_key}

    logger.info("Fetching Pexels photo by id", photo_id=photo_id)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=PEXELS_TIMEOUT_SECONDS),
            ) as response:
                if response.status == 200:
                    photo = await response.json()
                    src = photo.get("src", {})
                    selected_url = _select_image_url(src, requested_width, requested_height)
                    resolved_id = str(photo.get("id", photo_id))
                    keywords_for_slug = asset.get("keywords", "")
                    if isinstance(keywords_for_slug, list):
                        keywords_for_slug = " ".join(keywords_for_slug)

                    # Provider images are served from the live CDN URL (object-
                    # store re-hosting was removed with the GCS coupling).
                    image_url = selected_url

                    asset["provider"] = "Pexels"
                    asset["providerImgId"] = resolved_id
                    asset["providerImgUrl"] = image_url
                    asset["datetimeGenerated"] = datetime.now().isoformat()
                    asset["isProcessed"] = True
                    processed_prop["src"] = image_url
                    logger.info(
                        "Pexels by-id fetch success",
                        photo_id=photo_id,
                        photographer=photo.get("photographer"),
                    )
                elif response.status == 404:
                    logger.warning(
                        "Pexels by-id fetch 404 — photo not found",
                        photo_id=photo_id,
                    )
                    _set_placeholder_asset(
                        asset, "by_id_not_found", provider_img_id=photo_id, provider="Pexels"
                    )
                elif response.status == 429:
                    logger.warning("Pexels API rate limited (429) on by-id fetch")
                    _set_placeholder_asset(
                        asset, "rate_limited", provider_img_id="rate_limited", provider="Pexels"
                    )
                else:
                    response_text = await response.text()
                    logger.warning(
                        "Pexels by-id API error",
                        status=response.status,
                        photo_id=photo_id,
                        response=response_text[:200],
                    )
                    _set_placeholder_asset(
                        asset,
                        "api_error",
                        provider_img_id=f"error_{response.status}",
                        provider="Pexels",
                    )
    except Exception as e:
        logger.error(
            "Exception fetching Pexels by id",
            error=str(e),
            photo_id=photo_id,
        )
        _set_placeholder_asset(asset, "exception", provider_img_id="exception", provider="Pexels")
    return processed_prop


def _select_pixabay_url(hit: dict, requested_width: int, requested_height: int) -> str:
    """Pick the best Pixabay image URL for the requested display box.

    Pixabay's free API exposes ``webformatURL`` (~640 px) and
    ``largeImageURL`` (~1280 px). Larger tiers (``fullHDURL``, ``imageURL``)
    need full API access, so we cap at ``largeImageURL``. Bias toward the
    smaller tier for small boxes to protect LCP.
    """
    budget = max(requested_width, requested_height)
    if budget >= 1000:
        url = hit.get("largeImageURL") or hit.get("webformatURL", "")
    else:
        url = hit.get("webformatURL") or hit.get("largeImageURL", "")
    return _normalize_image_url(url)


async def get_image_from_pixabay(
    processed_prop: dict,
    exclude_urls: set[str] | None = None,
    app_uuid: str = "",
) -> dict:
    """Fetch an image from the Pixabay API based on the asset keywords.

    Pixabay is a FREE provider (free API key, commercial-use license, no
    attribution required). Mirrors the Pexels path: keyword search with
    progressive query simplification + per-slot dedup. ``app_uuid`` is
    accepted for signature parity (object-store re-hosting was removed with
    the GCS coupling); the chosen CDN URL is embedded directly.
    """
    del app_uuid  # embedded directly — no re-hosting in the self-host build
    api_key = os.getenv("PIXABAY_API_KEY")

    if not api_key:
        logger.warning(
            "image_provider_api_key_missing — image forced to placeholder ('#'). "
            "Set PIXABAY_API_KEY (or PEXELS_API_KEY / UNSPLASH_API_KEY) to enable "
            "real image sourcing.",
            provider="Pixabay",
        )
        _set_placeholder_asset(processed_prop.get("asset", {}), "no_api_key", provider="Pixabay")
        return processed_prop

    try:
        asset = processed_prop.get("asset", {})
        keywords = asset.get("keywords", "abstract background")
        search_query = " ".join(keywords) if isinstance(keywords, list) else str(keywords)
        search_query = _preprocess_keywords(search_query)

        requested_width = asset.get("requested_width", 1920)
        requested_height = asset.get("requested_height", 1080)

        logger.info(
            "Searching Pixabay",
            query=search_query,
            dimensions=f"{requested_width}x{requested_height}",
        )

        base_params: dict = {
            "key": api_key,
            "image_type": "photo",
            "safesearch": "true",
            "per_page": 5,
            "page": 1,
            "orientation": _pixabay_orientation(requested_width, requested_height),
        }
        _excluded = exclude_urls or set()

        async with aiohttp.ClientSession() as session:
            hit = None
            query_variants = _build_query_variants(search_query)
            for i, query in enumerate(query_variants):
                params = {**base_params, "q": query}
                async with session.get(
                    PIXABAY_API_URL,
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=PIXABAY_TIMEOUT_SECONDS),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        hits = data.get("hits", [])
                        for candidate in hits:
                            candidate_url = _select_pixabay_url(
                                candidate, requested_width, requested_height
                            )
                            if candidate_url and candidate_url not in _excluded:
                                hit = candidate
                                break
                        if not hit and hits:
                            hit = hits[0]
                        if hit:
                            if query != search_query:
                                logger.info(
                                    "Pixabay found result with simplified query",
                                    original=search_query,
                                    used=query,
                                )
                            break
                    elif response.status == 429:
                        logger.warning("Pixabay API rate limited (429)")
                        _set_placeholder_asset(
                            asset,
                            "rate_limited",
                            provider_img_id="rate_limited",
                            provider="Pixabay",
                        )
                        return processed_prop
                    else:
                        response_text = await response.text()
                        logger.warning(
                            "Pixabay API error",
                            status=response.status,
                            response=response_text[:200],
                        )
                        _set_placeholder_asset(
                            asset,
                            "api_error",
                            provider_img_id=f"error_{response.status}",
                            provider="Pixabay",
                        )
                        return processed_prop

                if i < len(query_variants) - 1:
                    logger.info("No Pixabay results, trying simpler query", query=query)

            if hit:
                image_url = _select_pixabay_url(hit, requested_width, requested_height)
                photo_id = str(hit.get("id"))
                asset["provider"] = "Pixabay"
                asset["providerImgId"] = photo_id
                asset["providerImgUrl"] = image_url
                asset["datetimeGenerated"] = datetime.now().isoformat()
                asset["isProcessed"] = True
                processed_prop["src"] = image_url
                logger.info("Found Pixabay image", user=hit.get("user"), photo_id=photo_id)
            else:
                logger.warning("No Pixabay results after all retries", query=search_query)
                _set_placeholder_asset(
                    asset, "no_results", provider_img_id="no_results", provider="Pixabay"
                )

    except Exception as e:  # noqa: BLE001
        logger.error("Exception fetching from Pixabay", error=str(e))
        _set_placeholder_asset(
            processed_prop.get("asset", {}),
            "exception",
            provider_img_id="exception",
            provider="Pixabay",
        )

    return processed_prop


async def get_pixabay_photo_by_id(
    processed_prop: dict,
    photo_id: str,
    app_uuid: str = "",
) -> dict:
    """Fetch a SPECIFIC Pixabay photo by numeric ID.

    Used by the array-placeholder resolver when an element preserves
    ``vendor: "pixabay"`` + ``assetId:`` so an unrelated edit doesn't swap
    an already-resolved Pixabay photo for a new search result. On failure
    the asset is marked with a placeholder reason and ``src`` stays empty so
    the caller can fall back to keyword search.
    """
    del app_uuid  # embedded directly — no re-hosting in the self-host build
    api_key = os.getenv("PIXABAY_API_KEY")
    if not api_key:
        logger.error("PIXABAY_API_KEY not found — by-id fetch cannot proceed")
        _set_placeholder_asset(processed_prop.get("asset", {}), "no_api_key", provider="Pixabay")
        return processed_prop

    if not photo_id or not str(photo_id).strip():
        return processed_prop

    asset = processed_prop.get("asset", {})
    requested_width = asset.get("requested_width", 1920)
    requested_height = asset.get("requested_height", 1080)
    photo_id = str(photo_id).strip()

    logger.info("Fetching Pixabay photo by id", photo_id=photo_id)

    try:
        params = {"key": api_key, "id": photo_id}
        async with aiohttp.ClientSession() as session:
            async with session.get(
                PIXABAY_API_URL,
                params=params,
                timeout=aiohttp.ClientTimeout(total=PIXABAY_TIMEOUT_SECONDS),
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    hits = data.get("hits", [])
                    if hits:
                        hit = hits[0]
                        image_url = _select_pixabay_url(hit, requested_width, requested_height)
                        asset["provider"] = "Pixabay"
                        asset["providerImgId"] = str(hit.get("id", photo_id))
                        asset["providerImgUrl"] = image_url
                        asset["datetimeGenerated"] = datetime.now().isoformat()
                        asset["isProcessed"] = True
                        processed_prop["src"] = image_url
                        logger.info("Pixabay by-id fetch success", photo_id=photo_id)
                    else:
                        logger.warning("Pixabay by-id fetch — photo not found", photo_id=photo_id)
                        _set_placeholder_asset(
                            asset, "by_id_not_found", provider_img_id=photo_id, provider="Pixabay"
                        )
                elif response.status == 429:
                    logger.warning("Pixabay API rate limited (429) on by-id fetch")
                    _set_placeholder_asset(
                        asset, "rate_limited", provider_img_id="rate_limited", provider="Pixabay"
                    )
                else:
                    response_text = await response.text()
                    logger.warning(
                        "Pixabay by-id API error",
                        status=response.status,
                        photo_id=photo_id,
                        response=response_text[:200],
                    )
                    _set_placeholder_asset(
                        asset,
                        "api_error",
                        provider_img_id=f"error_{response.status}",
                        provider="Pixabay",
                    )
    except Exception as e:  # noqa: BLE001
        logger.error("Exception fetching Pixabay by id", error=str(e), photo_id=photo_id)
        _set_placeholder_asset(asset, "exception", provider_img_id="exception", provider="Pixabay")
    return processed_prop


def _openverse_thumbnail_url(result: dict) -> str:
    """Return an Openverse-hosted thumbnail URL for a search result.

    Openverse ``result.url`` points at the arbitrary upstream host (Flickr,
    Wikimedia, …) which is neither CSP-allowlisted nor stable. The
    ``thumbnail`` field is served from ``api.openverse.org`` (a single,
    allowlistable host) and is already reasonably sized, so we embed that.
    """
    thumb = result.get("thumbnail")
    if thumb:
        return _normalize_image_url(thumb)
    image_id = result.get("id")
    if image_id:
        return f"{OPENVERSE_API_URL}{image_id}/thumb/"
    return _normalize_image_url(result.get("url", ""))


def _apply_openverse_result(asset: dict, processed_prop: dict, result: dict) -> None:
    """Populate asset + src from an Openverse search/detail result.

    CC content requires attribution, so creator + license are stored on the
    asset even though the runtime may not surface them.
    """
    image_url = _openverse_thumbnail_url(result)
    asset["provider"] = "Openverse"
    asset["providerImgId"] = str(result.get("id", ""))
    asset["providerImgUrl"] = image_url
    asset["attribution"] = {
        "photographer": result.get("creator", "") or "",
        "photographer_url": result.get("creator_url", "") or "",
        "source": f"Openverse ({result.get('license', '')})".strip(),
        "source_url": result.get("foreign_landing_url", "") or "",
        "license": result.get("license", "") or "",
        "license_url": result.get("license_url", "") or "",
    }
    asset["datetimeGenerated"] = datetime.now().isoformat()
    asset["isProcessed"] = True
    processed_prop["src"] = image_url


async def get_image_from_openverse(
    processed_prop: dict,
    exclude_urls: set[str] | None = None,
    app_uuid: str = "",
) -> dict:
    """Keyless fallback: fetch a Creative-Commons image from Openverse.

    Openverse needs no API key and IS keyword-searchable, so it makes a
    better keyless fallback than Lorem Picsum (which can only return a
    deterministic-but-unrelated image). Filtered to commercially-usable
    licenses. The Openverse-hosted thumbnail URL is embedded directly.
    """
    del app_uuid  # keyless, thumbnail hotlink-safe — no re-hosting
    try:
        asset = processed_prop.get("asset", {})
        keywords = asset.get("keywords", "abstract background")
        search_query = " ".join(keywords) if isinstance(keywords, list) else str(keywords)
        search_query = _preprocess_keywords(search_query)

        requested_width = asset.get("requested_width", 1920)
        requested_height = asset.get("requested_height", 1080)
        aspect_ratio = _openverse_orientation(requested_width, requested_height)
        _excluded = exclude_urls or set()

        logger.info("Searching Openverse", query=search_query, aspect_ratio=aspect_ratio)

        base_params: dict = {
            "license_type": "commercial",
            "page_size": 8,
            "aspect_ratio": aspect_ratio,
            "mature": "false",
        }

        async with aiohttp.ClientSession() as session:
            result = None
            for query in _build_query_variants(search_query):
                params = {**base_params, "q": query}
                async with session.get(
                    OPENVERSE_API_URL,
                    params=params,
                    headers={"Accept": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=OPENVERSE_TIMEOUT_SECONDS),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        results = data.get("results", [])
                        for candidate in results:
                            cand_url = _openverse_thumbnail_url(candidate)
                            if cand_url and cand_url not in _excluded:
                                result = candidate
                                break
                        if not result and results:
                            result = results[0]
                        if result:
                            break
                    elif response.status == 429:
                        logger.warning("Openverse API rate limited (429)")
                        _set_placeholder_asset(
                            asset,
                            "rate_limited",
                            provider_img_id="rate_limited",
                            provider="Openverse",
                        )
                        return processed_prop
                    else:
                        response_text = await response.text()
                        logger.warning(
                            "Openverse API error",
                            status=response.status,
                            response=response_text[:200],
                        )
                        _set_placeholder_asset(
                            asset,
                            "api_error",
                            provider_img_id=f"error_{response.status}",
                            provider="Openverse",
                        )
                        return processed_prop

            if result:
                _apply_openverse_result(asset, processed_prop, result)
                logger.info(
                    "Found Openverse image",
                    creator=result.get("creator"),
                    image_id=result.get("id"),
                )
            else:
                logger.warning("No Openverse results after all retries", query=search_query)
                _set_placeholder_asset(
                    asset, "no_results", provider_img_id="no_results", provider="Openverse"
                )

    except Exception as e:  # noqa: BLE001
        logger.error("Exception fetching from Openverse", error=str(e))
        _set_placeholder_asset(
            processed_prop.get("asset", {}),
            "exception",
            provider_img_id="exception",
            provider="Openverse",
        )

    return processed_prop


async def get_openverse_image_by_id(
    processed_prop: dict,
    image_id: str,
    app_uuid: str = "",
) -> dict:
    """Fetch a SPECIFIC Openverse image by ID (keyless).

    Mirrors the other by-id fetchers so a preserved ``vendor: "openverse"``
    + ``assetId:`` pair re-resolves to the same CC image across edits.
    """
    del app_uuid  # keyless, thumbnail hotlink-safe — no re-hosting
    if not image_id or not str(image_id).strip():
        return processed_prop

    asset = processed_prop.get("asset", {})
    image_id = str(image_id).strip()

    logger.info("Fetching Openverse image by id", image_id=image_id)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{OPENVERSE_API_URL}{image_id}/",
                headers={"Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=OPENVERSE_TIMEOUT_SECONDS),
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    _apply_openverse_result(asset, processed_prop, result)
                    logger.info("Openverse by-id fetch success", image_id=image_id)
                elif response.status in (404, 400):
                    logger.warning("Openverse by-id fetch — image not found", image_id=image_id)
                    _set_placeholder_asset(
                        asset, "by_id_not_found", provider_img_id=image_id, provider="Openverse"
                    )
                else:
                    logger.warning("Openverse by-id API error", status=response.status)
                    _set_placeholder_asset(
                        asset,
                        "api_error",
                        provider_img_id=f"error_{response.status}",
                        provider="Openverse",
                    )
    except Exception as e:  # noqa: BLE001
        logger.error("Exception fetching Openverse by id", error=str(e), image_id=image_id)
        _set_placeholder_asset(
            asset, "exception", provider_img_id="exception", provider="Openverse"
        )
    return processed_prop


def _picsum_seed(keywords: str) -> str:
    """Stable, URL-safe seed slug for Lorem Picsum from keywords."""
    slug = re.sub(r"[^a-z0-9]+", "-", (keywords or "").lower()).strip("-")
    return (slug or "image")[:40]


async def get_image_from_picsum(processed_prop: dict) -> dict:
    """Keyless fallback: build a deterministic Lorem Picsum URL.

    Picsum needs no API key and serves stable, hotlink-safe images, but it
    is NOT keyword-searchable — the seed only guarantees a *consistent*
    image per slot, not a *topical* one. Used only when no keyed stock
    provider is configured, to fill genuine placeholders that have no
    usable LLM URL. No HTTP request is made (pure URL construction).
    """
    asset = processed_prop.get("asset", {})
    keywords = asset.get("keywords", "") or "image"
    if isinstance(keywords, list):
        keywords = " ".join(keywords)
    seed = _picsum_seed(str(keywords))
    width = max(1, min(int(asset.get("requested_width") or 800), 1600))
    height = max(1, min(int(asset.get("requested_height") or 600), 1600))
    url = f"https://picsum.photos/seed/{seed}/{width}/{height}"

    asset["provider"] = "Picsum"
    asset["providerImgId"] = seed
    asset["providerImgUrl"] = url
    asset["datetimeGenerated"] = datetime.now().isoformat()
    asset["isProcessed"] = True
    processed_prop["src"] = url
    logger.info("Picsum keyless image", seed=seed, dimensions=f"{width}x{height}")
    return processed_prop


def _unsplash_orientation(width: int, height: int) -> str:
    """Map requested dimensions to an Unsplash orientation filter value."""
    if width > height * 1.1:
        return "landscape"
    if height > width * 1.1:
        return "portrait"
    return "squarish"


def _unsplash_image_url(urls: dict, requested_width: int) -> str:
    """Pick + size an Unsplash image URL.

    Prefers ``urls.raw`` with Imgix sizing params (``w``/``q``/``fit``);
    falls back to the pre-sized tiers. Unsplash requires hotlinking their
    CDN, so the URL is embedded directly (never rehosted).
    """
    raw = urls.get("raw")
    if raw:
        w = max(1, min(int(requested_width or 1080), 1600))
        sep = "&" if "?" in raw else "?"
        return _normalize_image_url(f"{raw}{sep}w={w}&q=80&fit=crop")
    return _normalize_image_url(urls.get("regular") or urls.get("full") or urls.get("small") or "")


async def _trigger_unsplash_download(
    session: aiohttp.ClientSession, photo: dict, api_key: str
) -> None:
    """Fire Unsplash's download endpoint.

    Required by the Unsplash API guidelines whenever a photo is "used"
    (here: embedded into a generated app). Best-effort — failures are
    logged but never block image resolution.
    """
    dl = (photo.get("links", {}) or {}).get("download_location")
    if not dl:
        return
    try:
        async with session.get(
            dl,
            headers={"Authorization": f"Client-ID {api_key}"},
            timeout=aiohttp.ClientTimeout(total=5),
        ) as r:
            await r.read()
    except Exception as e:  # noqa: BLE001 — compliance ping is best-effort
        logger.warning("Unsplash download ping failed", error=str(e))


async def get_image_from_unsplash(
    processed_prop: dict,
    exclude_urls: set[str] | None = None,
    app_uuid: str = "",
) -> dict:
    """Fetch an image from the Unsplash API based on the asset keywords.

    Unsplash URLs are hotlink-safe and Unsplash requires hotlinking (not
    rehosting), so the returned ``urls.raw`` URL is embedded directly and
    ``app_uuid`` is accepted only for signature parity with the other
    providers. Photographer + source attribution is stored on the asset.
    """
    del app_uuid  # Unsplash mandates hotlinking — never rehost to GCS.
    api_key = os.getenv("UNSPLASH_API_KEY")
    if not api_key:
        logger.warning(
            "image_provider_api_key_missing — image forced to placeholder ('#').",
            provider="Unsplash",
        )
        _set_placeholder_asset(processed_prop.get("asset", {}), "no_api_key", provider="Unsplash")
        return processed_prop

    try:
        asset = processed_prop.get("asset", {})
        keywords = asset.get("keywords", "abstract background")
        search_query = " ".join(keywords) if isinstance(keywords, list) else str(keywords)
        search_query = _preprocess_keywords(search_query)

        requested_width = asset.get("requested_width", 1920)
        requested_height = asset.get("requested_height", 1080)
        orientation = _unsplash_orientation(requested_width, requested_height)
        headers = {"Authorization": f"Client-ID {api_key}", "Accept-Version": "v1"}
        _excluded = exclude_urls or set()

        logger.info("Searching Unsplash", query=search_query, orientation=orientation)

        async with aiohttp.ClientSession() as session:
            photo = None
            for query in _build_query_variants(search_query):
                params = {"query": query, "per_page": 5, "orientation": orientation}
                async with session.get(
                    UNSPLASH_API_URL,
                    headers=headers,
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=UNSPLASH_TIMEOUT_SECONDS),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        results = data.get("results", [])
                        for candidate in results:
                            cand_url = _unsplash_image_url(
                                candidate.get("urls", {}), requested_width
                            )
                            if cand_url and cand_url not in _excluded:
                                photo = candidate
                                break
                        if not photo and results:
                            photo = results[0]
                        if photo:
                            break
                    elif response.status == 429:
                        logger.warning("Unsplash API rate limited (429)")
                        _set_placeholder_asset(
                            asset,
                            "rate_limited",
                            provider_img_id="rate_limited",
                            provider="Unsplash",
                        )
                        return processed_prop
                    else:
                        response_text = await response.text()
                        logger.warning(
                            "Unsplash API error",
                            status=response.status,
                            response=response_text[:200],
                        )
                        _set_placeholder_asset(
                            asset,
                            "api_error",
                            provider_img_id=f"error_{response.status}",
                            provider="Unsplash",
                        )
                        return processed_prop

            if photo:
                image_url = _unsplash_image_url(photo.get("urls", {}), requested_width)
                photo_id = str(photo.get("id"))
                # Unsplash guideline: trigger a download event when a photo is used.
                await _trigger_unsplash_download(session, photo, api_key)

                user = photo.get("user", {}) or {}
                asset["provider"] = "Unsplash"
                asset["providerImgId"] = photo_id
                asset["providerImgUrl"] = image_url
                asset["attribution"] = {
                    "photographer": user.get("name", ""),
                    "photographer_url": (user.get("links", {}) or {}).get("html", ""),
                    "source": "Unsplash",
                    "source_url": (photo.get("links", {}) or {}).get("html", ""),
                }
                asset["datetimeGenerated"] = datetime.now().isoformat()
                asset["isProcessed"] = True
                processed_prop["src"] = image_url
                logger.info(
                    "Found Unsplash image",
                    photographer=user.get("name"),
                    photo_id=photo_id,
                )
            else:
                logger.warning("No Unsplash results after all retries", query=search_query)
                _set_placeholder_asset(
                    asset, "no_results", provider_img_id="no_results", provider="Unsplash"
                )

    except Exception as e:  # noqa: BLE001
        logger.error("Exception fetching from Unsplash", error=str(e))
        _set_placeholder_asset(
            processed_prop.get("asset", {}),
            "exception",
            provider_img_id="exception",
            provider="Unsplash",
        )

    return processed_prop


def _ordered_keyed_providers():
    """Return the configured keyed-provider fetchers in preference order.

    All three are free. ``IMAGE_PROVIDER`` nudges which one is tried first;
    the rest follow in a stable order so every configured provider is a
    fallback for the others (rate-limit, no-results, transient error).
    """
    available = {
        "pexels": (os.getenv("PEXELS_API_KEY"), get_image_from_pexels),
        "pixabay": (os.getenv("PIXABAY_API_KEY"), get_image_from_pixabay),
        "unsplash": (os.getenv("UNSPLASH_API_KEY"), get_image_from_unsplash),
    }
    order = ["pexels", "pixabay", "unsplash"]
    if IMAGE_PROVIDER in order:
        order.remove(IMAGE_PROVIDER)
        order.insert(0, IMAGE_PROVIDER)
    return [available[name][1] for name in order if (available[name][0] or "").strip()]


def _has_usable_src(processed_prop: dict) -> bool:
    """True when the prop carries a real, non-placeholder image src."""
    src = processed_prop.get("src", "")
    return bool(src) and src != "#"


async def process_one_image_prop(
    image_prop: dict,
    exclude_urls: set[str] | None = None,
    app_uuid: str = "",
) -> dict:
    """Process a single ImageProps component by sourcing its image.

    Provider selection is a FREE-only fallback chain (no importance tiering,
    no paid providers):

    - No keyed provider configured → keyless: Openverse (CC, keyword-search)
      then a deterministic Lorem Picsum image if Openverse yields nothing.
    - Keyed provider(s) configured → try each configured keyed provider
      (Pexels / Pixabay / Unsplash, ``IMAGE_PROVIDER`` first) until one
      returns a usable image, then Openverse as a keyless last resort.

    Args:
        image_prop: ImageProps dictionary to process
        exclude_urls: URLs to skip (for deduplication across image slots)
        app_uuid: Retained for signature parity (no object-store re-hosting
            in the self-host build).

    Returns:
        Processed copy with resolved image URL
    """
    processed_prop = copy.deepcopy(image_prop)

    logger.debug("Processing ImageProps", uuid=processed_prop.get("uuid", "unknown"))

    if "asset" in processed_prop and isinstance(processed_prop["asset"], dict):
        if not stock_provider_configured():
            # Keyless install: Openverse can still keyword-search CC imagery;
            # fall back to a deterministic Picsum image only if it comes up
            # empty. (Working LLM URLs are kept upstream and never reach here.)
            processed_prop = await get_image_from_openverse(
                processed_prop, exclude_urls, app_uuid=app_uuid
            )
            if not _has_usable_src(processed_prop):
                processed_prop = await get_image_from_picsum(processed_prop)
            return processed_prop

        # Keyed install: walk the configured providers, then Openverse.
        for fetch in _ordered_keyed_providers():
            processed_prop = await fetch(processed_prop, exclude_urls, app_uuid=app_uuid)
            if _has_usable_src(processed_prop):
                break

        # Keyless last resort when every keyed provider came up empty (no
        # results, rate-limited, or transient error).
        if not _has_usable_src(processed_prop):
            processed_prop = await get_image_from_openverse(
                processed_prop, exclude_urls, app_uuid=app_uuid
            )

    logger.debug("Processed ImageProps", uuid=processed_prop.get("uuid", "unknown"))
    return processed_prop
