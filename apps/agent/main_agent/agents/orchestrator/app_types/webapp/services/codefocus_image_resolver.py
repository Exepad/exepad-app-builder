"""
Code Focus image resolver — post-build stock image resolution.

Scans TSX component sources for placeholder and hallucinated image URLs,
fetches properly licensed FREE stock images (Pexels / Pixabay / Unsplash, with
keyless Openverse as a last resort) using alt text as search keywords, and
replaces the src values in-place.
"""

import asyncio
import re

import structlog

from main_agent.agents.utils.image_generation_utils import (
    get_openverse_image_by_id,
    get_pexels_photo_by_id,
    get_pixabay_photo_by_id,
    keep_llm_image_urls,
    process_one_image_prop,
    stock_provider_configured,
)
from main_agent.services.validation.semantic_validator import (
    _PLACEHOLDER_DIV_PATTERN,
    _is_image_domain_allowed,
)

logger = structlog.get_logger(__name__)

_MAX_CONCURRENT_FETCHES = 5

_PLACEHOLDER_SENTINEL = "__PLACEHOLDER__"

_IMG_TAG_PATTERN = re.compile(
    r"<img\b[^>]*?>",
    re.IGNORECASE | re.DOTALL,
)

_SRC_PATTERN = re.compile(r"""src=["']([^"']*)["']""")
_ALT_PATTERN = re.compile(r"""alt=["']([^"']*)["']""")
# Dynamic JSX expression: src={item.image}, src={getUrl()}, etc.
_DYNAMIC_SRC_PATTERN = re.compile(r"src=\{[^}]+\}")

# --- ExepadImage component patterns ---

# Matches self-closing <ExepadImage ... /> tags (the only valid form)
_EXEPAD_IMAGE_PATTERN = re.compile(
    r"<ExepadImage\b([^>]*?)/>",
    re.DOTALL,
)

# Prop extractors for <ExepadImage> JSX tags (use = for prop assignment)
_EXEPAD_KEYWORDS_PATTERN = re.compile(r"""keywords=\{?["']([^"']+)["']\}?""")
_EXEPAD_WIDTH_PATTERN = re.compile(r"width=\{(\d+)\}")
_EXEPAD_HEIGHT_PATTERN = re.compile(r"height=\{(\d+)\}")
_EXEPAD_IMPORTANCE_PATTERN = re.compile(r"importance=\{(\d+)\}")
_EXEPAD_VENDOR_PATTERN = re.compile(r"""vendor=["']([^"']+)["']""")
_EXEPAD_ASSET_ID_PATTERN = re.compile(r"""assetId=["']([^"']+)["']""")
# Design-import asset reference the post-import materializer writes after
# scanning imported HTML. The resolver rewrites this into a real
# src="/a/<app_uuid>/repo/assets/<relpath>" URL and strips the attribute from
# the output TSX.
_EXEPAD_DATA_ASSET_RELPATH_PATTERN = re.compile(r"""data-asset-relpath=["']([^"']*)["']""")

# Prop extractors for JS object literals (use : for key-value pairs)
# e.g. { keywords: "dog sitting", importance: 6 }
_OBJ_KEYWORDS_PATTERN = re.compile(r"""keywords:\s*["']([^"']+)["']""")
_OBJ_IMPORTANCE_PATTERN = re.compile(r"""importance:\s*(\d+)""")

# Matches ExepadImage prop objects in JS arrays/objects:
#   image: { keywords: "...", importance: N }
#   before: { keywords: "...", importance: N }
#   after: { keywords: "...", importance: N }
# Captures the full object including the key prefix.
_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN = re.compile(
    r"(?:image|before|after|photo|thumbnail|cover|avatar|src):\s*(\{[^}]*?keywords:\s*[\"'][^\"']+[\"'][^}]*?\})",
    re.DOTALL,
)

_DEFAULT_IMPORTANCE = 5

# Vendors whose images can be re-fetched by a stable id, so a preserved
# ``vendor`` + ``assetId`` pair survives unrelated edits instead of being
# re-searched.
_BY_ID_VENDORS = frozenset({"pexels", "pixabay", "openverse"})


async def _fetch_by_id(vendor: str, image_prop: dict, asset_id: str, app_uuid: str) -> dict:
    """Dispatch a by-id refetch to the vendor's fetcher.

    Names are resolved through the module globals at call time (not captured
    in a dict at import) so monkeypatching a fetcher in tests takes effect.
    """
    if vendor == "pexels":
        return await get_pexels_photo_by_id(image_prop, asset_id, app_uuid=app_uuid)
    if vendor == "pixabay":
        return await get_pixabay_photo_by_id(image_prop, asset_id, app_uuid=app_uuid)
    return await get_openverse_image_by_id(image_prop, asset_id, app_uuid=app_uuid)


def _inject_or_replace_src(tag: str, url: str) -> str:
    """Inject or replace the src attribute in an <img> tag."""
    if _SRC_PATTERN.search(tag):
        return _SRC_PATTERN.sub(f'src="{url}"', tag)

    # Do NOT replace dynamic src={...} expressions — they reference JS
    # variables (e.g., src={item.image} in .map() loops).  Phase 0.5
    # already resolves the data-array __PLACEHOLDER__ values that these
    # expressions read from.
    if _DYNAMIC_SRC_PATTERN.search(tag):
        return tag

    return re.sub(r"(<img\b)", rf'\1 src="{url}"', tag, count=1, flags=re.IGNORECASE)


def _inject_or_replace_alt(tag: str, alt_text: str) -> str:
    """Inject or replace the alt attribute in an <img> tag."""
    safe_alt = alt_text.replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    if _ALT_PATTERN.search(tag):
        return _ALT_PATTERN.sub(f'alt="{safe_alt}"', tag)

    # If there's already a dynamic alt={...}, leave it alone
    if re.search(r"alt=\{[^}]*\}", tag):
        return tag

    return re.sub(r"(<img\b)", rf'\1 alt="{safe_alt}"', tag, count=1, flags=re.IGNORECASE)


# Context keywords that suggest portrait-oriented images
_PORTRAIT_CONTEXT_WORDS = frozenset(
    {
        "team",
        "member",
        "portrait",
        "headshot",
        "profile",
        "avatar",
        "person",
        "founder",
        "ceo",
        "author",
        "staff",
        "employee",
        "architect",
        "designer",
        "engineer",
        "doctor",
        "chef",
        "therapist",
    }
)

# Context keywords that suggest landscape-oriented images
_LANDSCAPE_CONTEXT_WORDS = frozenset(
    {
        "hero",
        "banner",
        "panorama",
        "featured",
        "showcase",
        "gallery",
        "landscape",
        "aerial",
        "skyline",
        "exterior",
        "interior",
        "workspace",
        "office",
    }
)


# Action verbs that drag a portrait search toward action shots showing
# bodies + tools + backs of workers instead of the face. When a portrait
# context (team member, founder, role) is detected, strip these from the
# search keywords so the stock provider returns face-forward portraits.
# Verbs are matched as whole tokens (case-insensitive).
_PORTRAIT_ACTION_BLOCK_WORDS = frozenset(
    {
        "checking",
        "examining",
        "holding",
        "working",
        "pouring",
        "mixing",
        "preparing",
        "operating",
        "fixing",
        "assembling",
        "carrying",
        "lifting",
        "writing",
        "typing",
        "cooking",
        "cleaning",
        "watering",
        "planting",
        "drilling",
        "welding",
        "sweeping",
        "dusting",
        "scrubbing",
        "stocking",
        "sorting",
    }
)


def _normalize_portrait_keywords(keywords: str, orientation: str) -> str:
    """Drop action verbs when the search is for a portrait.

    Keeps the keyword string intact for landscape/square orientations.
    For portrait, strips ``_PORTRAIT_ACTION_BLOCK_WORDS`` and ensures the
    word ``portrait`` is present so the stock provider biases toward
    face-forward shots. Idempotent — running twice produces the same
    output.
    """
    if orientation != "portrait" or not keywords:
        return keywords
    tokens = [tok for tok in keywords.split() if tok.strip()]
    cleaned = [tok for tok in tokens if tok.lower() not in _PORTRAIT_ACTION_BLOCK_WORDS]
    if not any(tok.lower() == "portrait" for tok in cleaned):
        cleaned = ["portrait"] + cleaned
    if cleaned == tokens:
        return keywords
    return " ".join(cleaned)


_MAP_KEYWORD_RE = re.compile(r"\bmap\b|\bmaps\b|\bsatellite\b", re.IGNORECASE)


def _convert_placeholder_divs_to_img(tsx: str) -> tuple[str, int]:
    """Pre-scan: convert LLM-generated placeholder divs into <img> tags.

    The LLM sometimes generates a gray box with descriptive text instead of
    a proper <img> tag. This converts those back so the main resolver can
    pick them up and fetch real stock images.

    Placeholder divs with map-related keywords are skipped — those should be
    OpenStreetMap iframes, not stock photos.

    Returns:
        (updated_tsx, count_of_conversions)
    """
    count = 0

    def _replace(m: re.Match) -> str:
        nonlocal count
        alt_text = m.group(1).strip()
        # Skip map-related placeholders — these should be iframes, not images
        if _MAP_KEYWORD_RE.search(alt_text):
            return m.group(0)
        count += 1
        return f'<img src="{_PLACEHOLDER_SENTINEL}" alt="{alt_text}" className="w-full h-full object-cover" />'

    updated = _PLACEHOLDER_DIV_PATTERN.sub(_replace, tsx)
    return updated, count


def _is_hallucinated_url(url: str) -> bool:
    """Check if a URL belongs to a blocked or unknown (non-allowlisted) domain."""
    try:
        domain = url.split("//", 1)[1].split("/", 1)[0].lower()
    except (IndexError, AttributeError):
        return False
    if _is_image_domain_allowed(domain):
        return False
    return True


def _needs_resolution(src: str, resolved_urls: set[str] | None = None) -> bool:
    """Determine if an image src needs stock image resolution."""
    if not src or src == _PLACEHOLDER_SENTINEL:
        return True
    # `__ASSET_IMG:assets/...__` is a deploy-time placeholder for an
    # imported repo asset (design-import path). The deploy pipeline
    # rewrites it to the final `/a/{public_id}/repo/...` URL after WebP
    # optimization. The image resolver must treat it as already resolved
    # so it doesn't re-route through stock-photo lookup.
    #
    # Before the html_to_tsx translator emitted this form directly, the
    # resolver's `data-asset-relpath` short-circuit rewrote it. With the
    # translator change (Fix 1.4 / RC#4, 2026-05-16) the placeholder
    # arrives on `<ExepadImage src=...>` from the start, and the
    # `_is_hallucinated_url` exception-catch fallback happened to also
    # return False for it. This explicit check makes the intent
    # documented and removes the dependency on a fortunate side effect.
    if src.startswith("__ASSET_IMG:"):
        return False
    if src.startswith("data:"):
        return True
    if resolved_urls and src in resolved_urls:
        return False
    if _is_hallucinated_url(src):
        # Operator disabled LLM-suggested image URLs → always re-source this
        # through the stock pipeline (keyless Openverse/Picsum if no keyed
        # provider). Otherwise keep the working LLM URL unless a keyed
        # keyword-search provider could re-source it: routing it to resolution
        # with no provider returns '#' and leaves a gray fallback div. Genuine
        # placeholder / empty / data: srcs are handled above and still resolve.
        if not keep_llm_image_urls():
            return True
        return stock_provider_configured()
    return False


def _extract_image_slots(tsx: str, resolved_urls: set[str] | None = None) -> list[dict]:
    """Extract all <img> tags that need stock image resolution.

    Returns a list of dicts with keys: full_match, src, alt, start, end.
    """
    slots = []
    for m in _IMG_TAG_PATTERN.finditer(tsx):
        tag = m.group(0)
        src_m = _SRC_PATTERN.search(tag)
        alt_m = _ALT_PATTERN.search(tag)

        # Skip tags with dynamic src={...} — these reference JS expressions
        # (e.g., src={item.image} in .map() loops) whose data-array values
        # are resolved separately in Phase 0.5.
        if not src_m and _DYNAMIC_SRC_PATTERN.search(tag):
            continue

        src = src_m.group(1) if src_m else ""
        alt = alt_m.group(1) if alt_m else ""

        if _needs_resolution(src, resolved_urls):
            slots.append(
                {
                    "full_match": tag,
                    "src": src,
                    "alt": alt,
                    "start": m.start(),
                    "end": m.end(),
                }
            )
    return slots


def _extract_context_from_tsx(tsx: str, img_start_pos: int) -> tuple[str, str]:
    """Extract contextual keywords and orientation hint from TSX near an <img> tag.

    Looks at the 500 chars before the <img> tag for headings, section names,
    and other context clues to enrich image search keywords and determine
    preferred orientation (portrait vs landscape).

    Returns:
        (context_keywords, orientation) where orientation is "portrait", "landscape",
        or "landscape" (default).
    """
    # Look at preceding context
    context_start = max(0, img_start_pos - 500)
    context_text = tsx[context_start:img_start_pos].lower()

    # Extract text from headings (h1-h6)
    heading_texts = re.findall(r"<h[1-6][^>]*>([^<]+)</h[1-6]>", context_text)
    context_keywords = " ".join(heading_texts).strip()

    # Detect orientation from context — tokenize on any non-alpha char to handle
    # HTML attributes like class="team" and text like "Team Members"
    context_tokens = set(re.findall(r"[a-z]+", context_text))
    orientation = "landscape"  # default

    if context_tokens & _PORTRAIT_CONTEXT_WORDS:
        orientation = "portrait"
    elif context_tokens & _LANDSCAPE_CONTEXT_WORDS:
        orientation = "landscape"

    return context_keywords, orientation


# Keyword tokens that indicate the consuming JSX is a logo/brand slot.
# When ANY of these is present in the <ExepadImage keywords="..."> value,
# the resolver prefers catalog entries that are transparency-safe
# (``has_transparent_bg=True``) and returns their ``transparent_variant_url``
# when available. This prevents the "black rectangle in the header / white
# rectangle in the footer" failure mode where a baked-bg PNG is rendered
# on themed surfaces or subjected to ``brightness-0 invert`` filters.
_LOGO_SLOT_TOKENS: frozenset[str] = frozenset({"logo", "brand", "wordmark", "mark", "logotype"})


def _is_logo_slot(keyword_tokens: set[str]) -> bool:
    return bool(keyword_tokens & _LOGO_SLOT_TOKENS)


def _resolved_catalog_url(catalog_img: dict) -> str:
    """Return the best URL for a catalog entry.

    Prefers ``transparent_variant_url`` when present — that's the rembg-
    cleaned sibling produced by Layer 5 for logos with baked backgrounds.
    Falls back to the original ``url`` otherwise.
    """
    return catalog_img.get("transparent_variant_url") or catalog_img.get("url", "")


def _try_catalog_match(
    keywords: str,
    image_catalog: list[dict],
    used_uuids: set[str],
) -> str | None:
    """Attempt keyword-based matching against the user's image catalog.

    Returns the image URL if a match with overlap score >= 2 is found.

    Logo-slot specialisation: when the keywords indicate a logo/brand
    container (``logo``, ``brand``, ``wordmark``, ``mark``, ``logotype``)
    the resolver filters to candidates with ``has_transparent_bg=True``
    first. Only if zero qualified candidates exist do we fall back to the
    unrestricted match. This keeps logo slots from resolving to
    baked-in-background assets that break on themed surfaces.
    """
    if not keywords or not image_catalog:
        return None

    keyword_tokens = set(keywords.lower().replace(",", " ").split())
    logo_slot = _is_logo_slot(keyword_tokens)

    def _search(pool: list[dict]) -> dict | None:
        best_match: dict | None = None
        best_score = 0
        for catalog_img in pool:
            cat_uuid = catalog_img.get("uuid", "")
            if cat_uuid in used_uuids:
                continue
            desc = (catalog_img.get("description", "") or "").lower()
            desc_tokens = set(desc.replace(",", " ").split())
            overlap = len(keyword_tokens & desc_tokens)
            # ``is_logo`` nudges ranking so a real catalog logo outranks a
            # non-logo on equal keyword overlap, but keyword overlap is
            # still primary.
            is_logo = bool(catalog_img.get("is_logo"))
            score = overlap * 2 + (1 if (logo_slot and is_logo) else 0)
            if score > best_score:
                best_score = score
                best_match = catalog_img
        # Keep overlap >= 2 as the minimum-relevance gate (score >= 4 after
        # the doubling). Logo-slot preference alone is not enough to
        # surface a completely unrelated image.
        if best_match and best_score >= 4:
            return best_match
        return None

    best_match: dict | None = None
    if logo_slot:
        # Prefer transparent-bg candidates for logo slots (Layer 5). A
        # transparent variant exists either because the source has real
        # alpha, or because rembg produced a clean sibling.
        transparent_pool = [c for c in image_catalog if c.get("has_transparent_bg")]
        best_match = _search(transparent_pool)
        if best_match is None:
            # Every transparent candidate is already used / fails the
            # relevance gate. Fall back to the full catalog so a
            # baked-background asset still beats returning None — the
            # component builder's filter rule (Layer 3) will then avoid
            # ``brightness-0 invert`` on it.
            best_match = _search(image_catalog)
    else:
        best_match = _search(image_catalog)

    if best_match is not None:
        used_uuids.add(best_match["uuid"])
        return _resolved_catalog_url(best_match)
    return None


def _build_image_prop(
    keywords: str,
    orientation: str = "landscape",
    importance: int = _DEFAULT_IMPORTANCE,
    width: int | None = None,
    height: int | None = None,
) -> dict:
    """Build an ImageProps-compatible dict for process_one_image_prop().

    Args:
        keywords: Search keywords for the stock photo API.
        orientation: "portrait", "landscape", or "square".
        importance: 1-10 score. Kept for ordering/telemetry — it no longer
            routes providers (all providers are free; the chain in
            process_one_image_prop tries each configured one in turn).
        width, height: Explicit display dimensions from the <ExepadImage> tag.
            When provided, they override the orientation-based defaults —
            this is the preferred path, letting the provider-side tier
            selector pick the smallest image that covers the display box.

    When width/height are not provided, falls back to mobile-first defaults.
    See apps/agent/main_agent/agents/utils/image_generation_utils.py
    `_select_image_url()` for how the provider tier is picked from these.
    """
    if width and height:
        # Use the caller's explicit dimensions, capped at 1200 (the same cap
        # the semantic validator enforces). The provider-side selector will
        # pick a smaller tier if the budget allows.
        width = min(width, 1200)
        height = min(height, 1200)
    elif orientation == "portrait":
        width, height = 600, 800
    elif orientation == "square":
        width, height = 600, 600
    else:
        width, height = 800, 500

    return {
        "src": "",
        "asset": {
            "keywords": _normalize_portrait_keywords(keywords, orientation),
            "requested_width": width,
            "requested_height": height,
            "importance": importance,
        },
    }


# --- Array placeholder resolution ---

# Matches a JS object literal containing an image-like key with __PLACEHOLDER__ value.
# Captures the full object (single nesting level only — no nested braces).
_ARRAY_OBJ_PLACEHOLDER_PATTERN = re.compile(
    r"\{[^{}]*?"
    r"(?:image|src|photo|avatar|thumbnail|cover|picture|img)"
    r"""\s*:\s*["']__PLACEHOLDER__["']"""
    r"[^{}]*?\}",
    re.DOTALL,
)

# Extracts alt/description text from within a matched object literal.
_ARRAY_ALT_EXTRACT = re.compile(
    r"""(?:alt|altText|alt_text|description|imageAlt)\s*:\s*["']([^"']+)["']""",
    re.IGNORECASE,
)

# Extracts the image key name to know which property to replace.
_ARRAY_IMAGE_KEY = re.compile(
    r"""((?:image|src|photo|avatar|thumbnail|cover|picture|img)\s*:\s*)["']__PLACEHOLDER__["']""",
    re.IGNORECASE,
)

# Extracts ``keywords: "<text>"`` from inside a placeholder object literal.
# Matched siblings drive the search query when the placeholder gets resolved
# via stock fetch — without this, the resolver fell back to "abstract
# background" + 800x500 even when the original LLM-emitted object preserved
# rich keyword data alongside the wiped src.
_ARRAY_KEYWORDS_EXTRACT = re.compile(
    r"""keywords\s*:\s*["']([^"']+)["']""",
)
_ARRAY_WIDTH_EXTRACT = re.compile(r"width\s*:\s*(\d+)")
_ARRAY_HEIGHT_EXTRACT = re.compile(r"height\s*:\s*(\d+)")
_ARRAY_IMPORTANCE_EXTRACT = re.compile(r"importance\s*:\s*(\d+)")
_ARRAY_VENDOR_EXTRACT = re.compile(
    r"""vendor\s*:\s*["']([^"']+)["']""",
)
_ARRAY_ASSET_ID_EXTRACT = re.compile(
    r"""assetId\s*:\s*["']([^"']+)["']""",
)


async def _resolve_array_placeholders(
    tsx: str,
    image_catalog: list[dict],
    used_uuids: set[str],
    used_urls: set[str],
    app_uuid: str = "",
) -> tuple[str, int, set[str]]:
    """Resolve __PLACEHOLDER__ values inside JS array object literals.

    When the LLM generates arrays like:
        const items = [
          { image: "__PLACEHOLDER__", alt: "sunset landscape" },
          { image: "__PLACEHOLDER__", alt: "wedding couple" },
        ];
    this function fetches a unique stock image for each item.

    Returns:
        (updated_tsx, count_resolved, new_urls)
    """
    matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
    if not matches:
        return tsx, 0, set()

    # Collect slots with full sibling metadata. The extra fields let the
    # resolver re-fetch the EXACT same image when the LLM preserved
    # ``vendor`` + ``assetId`` (which is the standard Creator-emitted
    # shape for stock-photo array elements). Without this, an "edit hero
    # styling" turn would silently swap every dish image to a generic
    # search result.
    slots: list[dict] = []
    for m in matches:
        obj_text = m.group(0)

        # Highest-priority signal: explicit keywords sibling.
        kw_m = _ARRAY_KEYWORDS_EXTRACT.search(obj_text)
        keywords = kw_m.group(1) if kw_m else ""

        if not keywords:
            # Fall back to alt-style siblings, then surrounding context.
            alt_m = _ARRAY_ALT_EXTRACT.search(obj_text)
            alt = alt_m.group(1) if alt_m else ""
            if not alt or alt.lower() in ("image", "photo", "placeholder"):
                ctx_kw, _ = _extract_context_from_tsx(tsx, m.start())
                keywords = ctx_kw if ctx_kw else "abstract background"
            else:
                keywords = alt

        width_m = _ARRAY_WIDTH_EXTRACT.search(obj_text)
        height_m = _ARRAY_HEIGHT_EXTRACT.search(obj_text)
        importance_m = _ARRAY_IMPORTANCE_EXTRACT.search(obj_text)
        vendor_m = _ARRAY_VENDOR_EXTRACT.search(obj_text)
        asset_id_m = _ARRAY_ASSET_ID_EXTRACT.search(obj_text)

        slots.append(
            {
                "start": m.start(),
                "end": m.end(),
                "obj_text": obj_text,
                "keywords": keywords,
                "width": int(width_m.group(1)) if width_m else None,
                "height": int(height_m.group(1)) if height_m else None,
                "importance": int(importance_m.group(1)) if importance_m else _DEFAULT_IMPORTANCE,
                "vendor": vendor_m.group(1).lower() if vendor_m else "",
                "asset_id": asset_id_m.group(1) if asset_id_m else "",
            }
        )

    # Fetch stock images concurrently
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_FETCHES)
    fetch_results: dict[int, str] = {}

    async def _fetch(idx: int, slot: dict) -> None:
        async with semaphore:
            keywords = slot["keywords"]
            vendor = slot["vendor"]
            asset_id = slot["asset_id"]

            # 1. By-id refetch — preserves the user's original image across edits.
            if asset_id and vendor in _BY_ID_VENDORS:
                image_prop = _build_image_prop(
                    keywords,
                    _orientation_from_dims(slot["width"], slot["height"]),
                    importance=slot["importance"],
                    width=slot["width"],
                    height=slot["height"],
                )
                processed = await _fetch_by_id(vendor, image_prop, asset_id, app_uuid)
                url = processed.get("src", "")
                if url and url != "#":
                    fetch_results[idx] = url
                    used_urls.add(url)
                    return
                # By-id fetch failed — fall through to keyword search.

            # 2. Catalog lookup.
            catalog_url = _try_catalog_match(keywords, image_catalog, used_uuids)
            if catalog_url:
                fetch_results[idx] = catalog_url
                used_urls.add(catalog_url)
                return

            # 3. Generic stock search by keywords.
            orientation = _orientation_from_dims(slot["width"], slot["height"])
            if orientation == "landscape":
                alt_tokens = set(re.findall(r"[a-z]+", keywords.lower()))
                if alt_tokens & _PORTRAIT_CONTEXT_WORDS:
                    orientation = "portrait"

            image_prop = _build_image_prop(
                keywords,
                orientation,
                importance=slot["importance"],
                width=slot["width"],
                height=slot["height"],
            )
            processed = await process_one_image_prop(
                image_prop,
                exclude_urls=used_urls,
                app_uuid=app_uuid,
            )
            url = processed.get("src", "")
            if url and url != "#":
                fetch_results[idx] = url
                used_urls.add(url)

    tasks = [_fetch(i, slot) for i, slot in enumerate(slots)]
    await asyncio.gather(*tasks)

    # Replace placeholders, working backwards to preserve offsets
    new_urls: set[str] = set()
    count = 0
    for i in range(len(slots) - 1, -1, -1):
        slot = slots[i]
        start = slot["start"]
        end = slot["end"]
        obj_text = slot["obj_text"]
        url = fetch_results.get(i)
        if url:
            key_m = _ARRAY_IMAGE_KEY.search(obj_text)
            if key_m:
                new_obj = (
                    obj_text[: key_m.start()]
                    + key_m.group(1)
                    + f'"{url}"'
                    + obj_text[key_m.end() :]
                )
                tsx = tsx[:start] + new_obj + tsx[end:]
                new_urls.add(url)
                count += 1

    return tsx, count, new_urls


def _orientation_from_dims(width: int | None, height: int | None) -> str:
    """Infer orientation from explicit array element dimensions.

    Falls back to ``"landscape"`` when dimensions are missing — preserves
    the legacy default that was hard-coded before sibling extraction.
    """
    if not width or not height:
        return "landscape"
    if height > width * 1.1:
        return "portrait"
    if width > height * 1.1:
        return "landscape"
    return "square"


def _parse_exepad_image_props(tag_body: str) -> dict:
    """Parse props from an <ExepadImage .../> tag body into a structured dict."""
    kw_m = _EXEPAD_KEYWORDS_PATTERN.search(tag_body)
    w_m = _EXEPAD_WIDTH_PATTERN.search(tag_body)
    h_m = _EXEPAD_HEIGHT_PATTERN.search(tag_body)
    imp_m = _EXEPAD_IMPORTANCE_PATTERN.search(tag_body)
    src_m = _SRC_PATTERN.search(tag_body)
    vendor_m = _EXEPAD_VENDOR_PATTERN.search(tag_body)
    asset_id_m = _EXEPAD_ASSET_ID_PATTERN.search(tag_body)
    asset_relpath_m = _EXEPAD_DATA_ASSET_RELPATH_PATTERN.search(tag_body)

    keywords = kw_m.group(1) if kw_m else ""
    width = int(w_m.group(1)) if w_m else None
    height = int(h_m.group(1)) if h_m else None
    importance = int(imp_m.group(1)) if imp_m else _DEFAULT_IMPORTANCE
    src = src_m.group(1) if src_m else ""
    vendor = vendor_m.group(1) if vendor_m else ""
    asset_id = asset_id_m.group(1) if asset_id_m else ""
    asset_relpath = asset_relpath_m.group(1) if asset_relpath_m else ""

    return {
        "keywords": keywords,
        "width": width,
        "height": height,
        "importance": importance,
        "src": src,
        "vendor": vendor,
        "assetId": asset_id,
        "asset_relpath": asset_relpath,
    }


def _repo_asset_url(app_uuid: str, relpath: str) -> str:
    """Emit a deploy-time placeholder for an imported repo asset.

    The backend deploy step (``exepad-backend/core/services/deploy.py`` —
    ``rewrite_image_placeholders_in_components``) rewrites
    ``__ASSET_IMG:{source_path}__`` to the final
    ``/a/{public_id}/repo/{optimized_path}`` URL, using the app's real
    ``public_id`` (not the agent's internal ``app_uuid``) and the
    post-optimization extension (WebP instead of the original PNG/JPG).

    Emitting the placeholder here routes design-import images through the
    same deploy-time rewrite pipe. Returning a pre-built URL that bakes the
    internal ``app_uuid`` produced 404s because the deploy pipeline serves
    under ``public_id``.

    The ``app_uuid`` argument is retained for signature stability; the
    value is no longer consulted.
    """
    del app_uuid  # intentionally unused — see docstring
    relpath = (relpath or "").lstrip("/")
    if not relpath:
        return ""
    return f"__ASSET_IMG:assets/{relpath}__"


def _resolve_repo_asset_tag(tag: str, url: str) -> str:
    """Rewrite an <ExepadImage> tag to use an imported repo-asset URL.

    Adds ``src="<url>"`` + ``vendor="design_import"`` and strips the
    ``data-asset-relpath`` attribute (the runtime has no use for it).
    """
    tag = _inject_src_into_exepad_image(tag, url, vendor="design_import")
    # Strip the now-resolved data-asset-relpath attribute.
    tag = _EXEPAD_DATA_ASSET_RELPATH_PATTERN.sub("", tag)
    # Collapse the resulting double-space.
    tag = re.sub(r"\s{2,}", " ", tag)
    return tag


def _exepad_image_orientation(width: int | None, height: int | None) -> str:
    """Determine orientation from explicit ExepadImage width/height props."""
    if width and height:
        if height > width:
            return "portrait"
        elif width == height:
            return "square"
    return "landscape"


def _inject_src_into_exepad_image(tag: str, url: str, vendor: str = "", asset_id: str = "") -> str:
    """Add or replace src, vendor, assetId props in an <ExepadImage .../> tag."""
    # Do NOT touch a tag that already has a dynamic src={...} expression — it
    # references a per-row JS variable (e.g. src={beer.image} inside a .map()).
    # Appending a static src= would produce a DUPLICATE attribute; JSX last-
    # wins, so every row would render the same static image (3h9jgqt5
    # BeerMenuContent, 2026-05-22). Mirrors the guard in _inject_or_replace_src.
    if _DYNAMIC_SRC_PATTERN.search(tag):
        return tag

    if _SRC_PATTERN.search(tag):
        tag = _SRC_PATTERN.sub(f'src="{url}"', tag)
    else:
        tag = re.sub(r"\s*/>$", f' src="{url}" />', tag.rstrip())

    # Inject or replace vendor
    if vendor:
        if _EXEPAD_VENDOR_PATTERN.search(tag):
            tag = _EXEPAD_VENDOR_PATTERN.sub(f'vendor="{vendor}"', tag)
        else:
            tag = re.sub(r"\s*/>$", f' vendor="{vendor}" />', tag.rstrip())

    # Inject or replace assetId
    if asset_id:
        if _EXEPAD_ASSET_ID_PATTERN.search(tag):
            tag = _EXEPAD_ASSET_ID_PATTERN.sub(f'assetId="{asset_id}"', tag)
        else:
            tag = re.sub(r"\s*/>$", f' assetId="{asset_id}" />', tag.rstrip())

    return tag


def _enrich_keywords_from_context(tsx: str, tag: str, tag_start: int, props: dict) -> bool:
    """When keywords is empty, try to derive it from alt or nearby headings.

    Returns True if keywords was set (or was already non-empty), False if
    the tag should be skipped entirely.
    """
    if props["keywords"]:
        return True
    alt_m = re.search(r"""alt=\{?["']([^"']+)["']\}?""", tag)
    if alt_m:
        props["keywords"] = alt_m.group(1)
        return True
    context_kw, _ = _extract_context_from_tsx(tsx, tag_start)
    if context_kw:
        props["keywords"] = context_kw
        return True
    return False


def _classify_exepad_tags(
    tsx: str,
    matches: list[re.Match],
    used_urls: set[str],
    app_uuid: str,
) -> tuple[list[tuple[int, int, str, dict]], list[tuple[int, int, str]]]:
    """Split <ExepadImage> matches into stock slots and repo-asset rewrites.

    Repo-asset rewrites carry already-resolved tags (data-asset-relpath
    resolved to the deployed repo asset URL) and are ready to substitute. Stock
    slots still need a stock-provider lookup.
    """
    slots: list[tuple[int, int, str, dict]] = []
    repo_asset_rewrites: list[tuple[int, int, str]] = []
    for m in matches:
        tag = m.group(0)
        tag_body = m.group(1)
        # Spread props (e.g. {...fw.image}) are resolved in Phase 0.25b.
        if re.search(r"\{\.\.\.\w", tag_body):
            continue
        props = _parse_exepad_image_props(tag_body)
        # Imported image: post-import materializer tagged with data-asset-relpath.
        if props.get("asset_relpath"):
            asset_url = _repo_asset_url(app_uuid, props["asset_relpath"])
            if asset_url:
                repo_asset_rewrites.append(
                    (m.start(), m.end(), _resolve_repo_asset_tag(tag, asset_url))
                )
                used_urls.add(asset_url)
                continue
        if not _enrich_keywords_from_context(tsx, tag, m.start(), props):
            continue
        # Skip already-resolved tags (have a valid src).
        if props["src"] and not _needs_resolution(props["src"], used_urls):
            continue
        slots.append((m.start(), m.end(), tag, props))
    return slots, repo_asset_rewrites


async def _fetch_stock_for_slot(
    idx: int,
    props: dict,
    image_catalog: list[dict],
    used_uuids: set[str],
    used_urls: set[str],
    app_uuid: str,
    semaphore: asyncio.Semaphore,
    fetch_results: dict,
) -> None:
    """Catalog → stock-provider lookup for one ExepadImage slot."""
    async with semaphore:
        keywords = props["keywords"]
        catalog_url = _try_catalog_match(keywords, image_catalog, used_uuids)
        if catalog_url:
            fetch_results[idx] = (catalog_url, "catalog", "")
            used_urls.add(catalog_url)
            return
        orientation = _exepad_image_orientation(props["width"], props["height"])
        image_prop = _build_image_prop(
            keywords,
            orientation,
            props["importance"],
            width=props["width"],
            height=props["height"],
        )
        processed = await process_one_image_prop(
            image_prop,
            exclude_urls=used_urls,
            app_uuid=app_uuid,
        )
        url = processed.get("src", "")
        if url and url != "#":
            asset = processed.get("asset", {})
            vendor = (asset.get("provider", "") or "").lower()
            asset_id = str(asset.get("providerImgId", "") or "")
            fetch_results[idx] = (url, vendor, asset_id)
            used_urls.add(url)


def _merge_rewrites(
    slots: list[tuple[int, int, str, dict]],
    fetch_results: dict,
    repo_asset_rewrites: list[tuple[int, int, str]],
) -> list[tuple[int, int, str, str]]:
    """Combine repo-asset and stock-fetch rewrites, sorted by descending start."""
    all_rewrites: list[tuple[int, int, str, str]] = []
    for start, end, new_tag in repo_asset_rewrites:
        all_rewrites.append((start, end, new_tag, "design_import"))
    for i, (start, end, tag, _props) in enumerate(slots):
        result = fetch_results.get(i)
        if not result:
            continue
        url, vendor, asset_id = result
        all_rewrites.append(
            (start, end, _inject_src_into_exepad_image(tag, url, vendor, asset_id), "stock")
        )
    all_rewrites.sort(key=lambda r: r[0], reverse=True)
    return all_rewrites


def _apply_rewrites_to_tsx(
    tsx: str, all_rewrites: list[tuple[int, int, str, str]]
) -> tuple[str, int, set[str]]:
    """Substitute rewritten tags into tsx. Returns (tsx, count, new_urls)."""
    new_urls: set[str] = set()
    count = 0
    for start, end, new_tag, kind in all_rewrites:
        url_m = _SRC_PATTERN.search(new_tag)
        url = url_m.group(1) if url_m else ""
        tsx = tsx[:start] + new_tag + tsx[end:]
        if url:
            new_urls.add(url)
        count += 1
        logger.info("ExepadImage resolved", kind=kind, url=url[:80])
    return tsx, count, new_urls


async def _resolve_exepad_images(
    tsx: str,
    image_catalog: list[dict],
    used_uuids: set[str],
    used_urls: set[str],
    app_uuid: str = "",
) -> tuple[str, int, int, set[str]]:
    """Resolve <ExepadImage> components by extracting structured props.

    Returns:
        (updated_tsx, total_resolved, exepad_image_count, new_urls)
    """
    matches = list(_EXEPAD_IMAGE_PATTERN.finditer(tsx))
    if not matches:
        return tsx, 0, 0, set()

    slots, repo_asset_rewrites = _classify_exepad_tags(tsx, matches, used_urls, app_uuid)
    slots.sort(key=lambda s: s[3]["importance"], reverse=True)

    exepad_image_count = len(slots) + len(repo_asset_rewrites)
    if not slots and not repo_asset_rewrites:
        return tsx, 0, 0, set()

    # Concurrent stock lookups for every non-bundle slot.
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_FETCHES)
    fetch_results: dict[int, tuple[str, str, str]] = {}
    tasks = [
        _fetch_stock_for_slot(
            i,
            props,
            image_catalog,
            used_uuids,
            used_urls,
            app_uuid,
            semaphore,
            fetch_results,
        )
        for i, (_, _, _, props) in enumerate(slots)
    ]
    if tasks:
        await asyncio.gather(*tasks)

    all_rewrites = _merge_rewrites(slots, fetch_results, repo_asset_rewrites)
    tsx, count, new_urls = _apply_rewrites_to_tsx(tsx, all_rewrites)

    for i, (_, _, _, props) in enumerate(slots):
        if fetch_results.get(i) is None:
            logger.warning(
                "ExepadImage unresolved — SDK component will render skeleton",
                keywords=props["keywords"][:50],
                importance=props["importance"],
            )

    return tsx, count, exepad_image_count, new_urls


async def _resolve_exepad_image_arrays(
    tsx: str,
    image_catalog: list[dict],
    used_uuids: set[str],
    used_urls: set[str],
    app_uuid: str = "",
) -> tuple[str, int, set[str]]:
    """Resolve image objects in JS arrays that use ExepadImage spread pattern.

    Matches: image: { keywords: "...", importance: N }
    Injects: src: "resolved_url" into the object.

    Returns:
        (updated_tsx, count_resolved, new_urls)
    """
    matches = list(_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN.finditer(tsx))
    if not matches:
        return tsx, 0, set()

    # Parse each object and collect slots
    slots: list[tuple[int, int, str, str, int]] = []
    for m in matches:
        obj_text = m.group(1)
        full_match_start = m.start(1)
        full_match_end = m.end(1)

        kw_m = _OBJ_KEYWORDS_PATTERN.search(obj_text)
        imp_m = _OBJ_IMPORTANCE_PATTERN.search(obj_text)
        keywords = kw_m.group(1) if kw_m else ""
        importance = int(imp_m.group(1)) if imp_m else _DEFAULT_IMPORTANCE

        if not keywords:
            continue
        # Skip if already has a src (JS object syntax: src: "...")
        if re.search(r"""src:\s*["']""", obj_text):
            continue

        slots.append((full_match_start, full_match_end, obj_text, keywords, importance))

    if not slots:
        return tsx, 0, set()

    # Sort by importance descending
    slots.sort(key=lambda s: s[4], reverse=True)

    # Fetch images concurrently — results carry (url, vendor, asset_id).
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_FETCHES)
    fetch_results: dict[int, tuple[str, str, str]] = {}

    async def _fetch(idx: int, keywords: str, importance: int) -> None:
        async with semaphore:
            catalog_url = _try_catalog_match(keywords, image_catalog, used_uuids)
            if catalog_url:
                fetch_results[idx] = (catalog_url, "catalog", "")
                used_urls.add(catalog_url)
                return

            image_prop = _build_image_prop(keywords, "landscape", importance)
            processed = await process_one_image_prop(
                image_prop,
                exclude_urls=used_urls,
                app_uuid=app_uuid,
            )
            url = processed.get("src", "")
            if url and url != "#":
                asset = processed.get("asset", {})
                vendor = (asset.get("provider", "") or "").lower()
                asset_id = str(asset.get("providerImgId", "") or "")
                fetch_results[idx] = (url, vendor, asset_id)
                used_urls.add(url)

    tasks = [_fetch(i, kw, imp) for i, (_, _, _, kw, imp) in enumerate(slots)]
    await asyncio.gather(*tasks)

    # Pair slots with results, then sort by start position descending
    # so string replacements don't shift earlier offsets.
    slots_with_results = [(slots[i], fetch_results.get(i)) for i in range(len(slots))]
    slots_with_results.sort(key=lambda x: x[0][0], reverse=True)

    new_urls: set[str] = set()
    count = 0
    for (start, end, obj_text, keywords, importance), result in slots_with_results:
        if result:
            url, vendor, asset_id = result
            # Inject src, vendor, assetId before the closing brace.
            # Strip trailing comma too — LLMs often emit trailing commas
            # which would produce `8, , src:` (double comma → esbuild error).
            new_obj = obj_text.rstrip().rstrip("}").rstrip().rstrip(",")
            new_obj = f'{new_obj}, src: "{url}", vendor: "{vendor}", assetId: "{asset_id}" }}'
            tsx = tsx[:start] + new_obj + tsx[end:]
            new_urls.add(url)
            count += 1

    return tsx, count, new_urls


async def resolve_placeholder_images(
    tsx_sources: dict[str, str],
    image_catalog: list[dict],
    app_uuid: str = "",
) -> tuple[dict[str, str], int]:
    """Scan TSX sources for placeholder/hallucinated image srcs and resolve to stock images.

    For each <img> tag with a placeholder or hallucinated src, extracts the alt
    text as search keywords, attempts catalog matching, then falls back to the
    free stock providers (Pexels / Pixabay / Unsplash, keyless Openverse last).

    Args:
        tsx_sources: {component_name: tsx_code} mapping
        image_catalog: User's image catalog from session state
        app_uuid: Retained for signature parity (no object-store re-hosting).

    Returns:
        (updated_tsx_sources, total_images_resolved)
    """
    all_fetch_tasks: list[tuple[str, int, dict, str, str]] = []
    used_uuids: set[str] = set()
    used_urls: set[str] = set()
    result_sources = dict(tsx_sources)
    total_resolved = 0
    total_catalog_matched = 0

    # Phase 0: Convert placeholder divs to <img> tags so the main resolver can pick them up.
    # The LLM sometimes generates gray-box divs with descriptive text instead of <img> tags.
    total_div_conversions = 0
    for comp_name, tsx in list(result_sources.items()):
        updated_tsx, conv_count = _convert_placeholder_divs_to_img(tsx)
        if conv_count > 0:
            result_sources[comp_name] = updated_tsx
            total_div_conversions += conv_count
            logger.info(
                "Converted placeholder divs to <img> tags",
                component=comp_name,
                count=conv_count,
            )
    if total_div_conversions > 0:
        logger.info(f"Phase 0: Converted {total_div_conversions} placeholder div(s) to <img> tags")

    # Phase 0.25: Resolve <ExepadImage> components (structured props path).
    # This runs before legacy <img> resolution because ExepadImage provides
    # explicit keywords, dimensions, and importance — no guessing needed.
    total_exepad_resolved = 0
    total_exepad_count = 0
    for comp_name, tsx in list(result_sources.items()):
        updated_tsx, count, ei_count, ei_urls = await _resolve_exepad_images(
            tsx,
            image_catalog,
            used_uuids,
            used_urls,
            app_uuid=app_uuid,
        )
        if count > 0:
            result_sources[comp_name] = updated_tsx
            total_exepad_resolved += count
            used_urls.update(ei_urls)
        total_exepad_count += ei_count
    if total_exepad_resolved > 0:
        logger.info(f"Phase 0.25: Resolved {total_exepad_resolved} ExepadImage component(s)")

    # Phase 0.25b: Resolve ExepadImage spread objects in JS arrays.
    total_exepad_array_resolved = 0
    for comp_name, tsx in list(result_sources.items()):
        updated_tsx, arr_count, arr_urls = await _resolve_exepad_image_arrays(
            tsx,
            image_catalog,
            used_uuids,
            used_urls,
            app_uuid=app_uuid,
        )
        if arr_count > 0:
            result_sources[comp_name] = updated_tsx
            total_exepad_array_resolved += arr_count
            used_urls.update(arr_urls)
    if total_exepad_array_resolved > 0:
        logger.info(
            f"Phase 0.25b: Resolved {total_exepad_array_resolved} ExepadImage array object(s)"
        )

    # Phase 0.5: Resolve __PLACEHOLDER__ values inside JS array object literals.
    # When the LLM generates arrays with per-item `image: "__PLACEHOLDER__"`, each
    # item gets a unique stock image. This runs before the <img> tag resolver because
    # those <img> tags use dynamic `src={item.image}` which the regex-based Phase 1
    # cannot process.
    total_array_resolved = 0
    for comp_name, tsx in list(result_sources.items()):
        updated_tsx, arr_count, arr_urls = await _resolve_array_placeholders(
            tsx,
            image_catalog,
            used_uuids,
            used_urls,
            app_uuid=app_uuid,
        )
        if arr_count > 0:
            result_sources[comp_name] = updated_tsx
            total_array_resolved += arr_count
            used_urls.update(arr_urls)
            logger.info(
                "Resolved array placeholders",
                component=comp_name,
                count=arr_count,
            )
    if total_array_resolved > 0:
        logger.info(f"Phase 0.5: Resolved {total_array_resolved} array placeholder(s)")

    # Phase 1: catalog matching + collect fetch tasks
    for comp_name, tsx in result_sources.items():
        slots = _extract_image_slots(tsx)
        if not slots:
            continue

        for slot in slots:
            alt = slot["alt"]
            if not alt or alt.lower() in ("image", "photo", "picture", "img", "placeholder"):
                # Try to enrich from context
                context_kw, _ = _extract_context_from_tsx(tsx, slot["start"])
                alt = context_kw if context_kw else "abstract background"

            catalog_url = _try_catalog_match(alt, image_catalog, used_uuids)
            if catalog_url:
                old_tag = slot["full_match"]
                new_tag = _inject_or_replace_src(old_tag, catalog_url)
                new_tag = _inject_or_replace_alt(new_tag, alt)
                result_sources[comp_name] = result_sources[comp_name].replace(old_tag, new_tag, 1)
                total_resolved += 1
                total_catalog_matched += 1
                used_urls.add(catalog_url)
                logger.info(
                    "Catalog-matched image",
                    component=comp_name,
                    alt=alt[:50],
                )
            else:
                # Extract context for orientation detection
                context_kw, orientation = _extract_context_from_tsx(tsx, slot["start"])
                # Enrich keywords with context if alt text is short
                enriched_alt = alt
                if context_kw and len(alt.split()) < 4:
                    enriched_alt = f"{context_kw} {alt}"
                all_fetch_tasks.append((comp_name, id(slot), slot, enriched_alt, orientation))

    if not all_fetch_tasks:
        total_all = (
            total_resolved
            + total_exepad_resolved
            + total_exepad_array_resolved
            + total_array_resolved
        )
        logger.info(
            "Image resolution complete",
            total_images=total_all,
            exepad_resolved=total_exepad_resolved,
            exepad_array_resolved=total_exepad_array_resolved,
            fallback_img_resolved=total_resolved,
            catalog_matched=total_catalog_matched,
            stock_fetched=0,
        )
        return result_sources, total_all

    # Phase 2: fetch from stock API concurrently
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_FETCHES)
    fetch_results: dict[int, str] = {}

    async def _fetch(slot_id: int, keywords: str, orientation: str) -> None:
        async with semaphore:
            image_prop = _build_image_prop(keywords, orientation)
            processed = await process_one_image_prop(
                image_prop,
                exclude_urls=used_urls,
                app_uuid=app_uuid,
            )
            url = processed.get("src", "")
            if url and url != "#":
                fetch_results[slot_id] = url
                used_urls.add(url)

    tasks = []
    for comp_name, slot_id, slot, alt, orientation in all_fetch_tasks:
        tasks.append(_fetch(slot_id, alt, orientation))

    logger.info(
        f"Fetching {len(tasks)} stock images for components",
    )
    await asyncio.gather(*tasks)

    # Phase 3: replace placeholders with fetched URLs
    stock_resolved = 0
    for comp_name, slot_id, slot, alt, orientation in all_fetch_tasks:
        url = fetch_results.get(slot_id)
        if url:
            old_tag = slot["full_match"]
            new_tag = _inject_or_replace_src(old_tag, url)
            new_tag = _inject_or_replace_alt(new_tag, alt)
            result_sources[comp_name] = result_sources[comp_name].replace(old_tag, new_tag, 1)
            total_resolved += 1
            stock_resolved += 1
            logger.info(
                "Stock image resolved",
                component=comp_name,
                alt=alt[:50],
                url=url[:80],
            )
        else:
            logger.warning(
                "Could not resolve stock image",
                component=comp_name,
                alt=alt[:50],
            )

    # Phase 4: hard cleanup — replace any remaining unresolved images with fallback div
    fallback_count = 0
    for comp_name, tsx in list(result_sources.items()):
        remaining_slots = _extract_image_slots(tsx, resolved_urls=used_urls)
        for slot in remaining_slots:
            alt = slot["alt"] or "Image"
            # Escape any HTML-unsafe chars in alt text
            safe_alt = alt.replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
            fallback_div = (
                f'<div className="w-full h-48 bg-surface-container flex items-center '
                f'justify-center rounded-lg border border-outline-variant border-dashed" '
                f'data-exepad-fallback="true">'
                f'<span className="text-on-surface-variant text-xs">{safe_alt}</span></div>'
            )
            result_sources[comp_name] = result_sources[comp_name].replace(
                slot["full_match"], fallback_div, 1
            )
            fallback_count += 1
            logger.warning(
                "Replaced unresolved image with fallback div",
                component=comp_name,
                alt=alt[:50],
            )

    # Build provider usage summary from fetched URLs (host-based heuristic).
    provider_counts: dict[str, int] = {"pexels": 0, "pixabay": 0, "openverse": 0, "other": 0}
    for comp_name, slot_id, slot, alt, orientation in all_fetch_tasks:
        url = fetch_results.get(slot_id)
        if url:
            if "pexels.com" in url:
                provider_counts["pexels"] += 1
            elif "pixabay.com" in url:
                provider_counts["pixabay"] += 1
            elif "openverse.org" in url:
                provider_counts["openverse"] += 1
            else:
                provider_counts["other"] += 1

    total_slots = (
        total_resolved
        + fallback_count
        + total_array_resolved
        + total_exepad_resolved
        + total_exepad_array_resolved
    )
    logger.info(
        "Image resolution summary",
        total_images=total_slots,
        exepad_image_count=total_exepad_count,
        exepad_resolved=total_exepad_resolved,
        exepad_array_resolved=total_exepad_array_resolved,
        fallback_img_resolved=total_resolved,
        fallback_array_resolved=total_array_resolved,
        catalog_matched=total_catalog_matched,
        pexels_fetched=provider_counts["pexels"],
        pixabay_fetched=provider_counts["pixabay"],
        openverse_fetched=provider_counts["openverse"],
        other_fetched=provider_counts["other"],
        fallback_divs=fallback_count,
    )

    return result_sources, (
        total_resolved
        + fallback_count
        + total_exepad_resolved
        + total_exepad_array_resolved
        + total_array_resolved
    )
